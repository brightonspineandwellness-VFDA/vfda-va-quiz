import "server-only";

import { buildDoctorFlow, type RuleRow, type Step } from "@/lib/doctor-flow";
import {
  profileFromAnswers,
  UPLOAD_BUCKET,
  type Answer,
  type GrayCard,
  type GrayCardQuestion,
  type InterviewQuestion,
  type QuizInfo,
} from "@/lib/interview";
import { createSessionClient } from "@/lib/supabase/server";

// Loads everything the office setup screen needs, as the signed-in user:
// row-level security limits doctors to their own office.
//
// Questions are the rule slots. An answer is the office's direct rule for a
// slot (an office_rules row with no source document). Gray cards are the
// office's gray card workflows (office_workflows).

export type InterviewData = {
  office: { id: string; name: string; status: string };
  questions: InterviewQuestion[];
  quizzes: QuizInfo[];
  conditions: Record<string, string>;
  grayCardQuestions: GrayCardQuestion[];
  answers: Record<string, Answer>;
  sources: Record<string, { source: RuleRow["source"]; status: RuleRow["status"] }>;
  grayCards: GrayCard[];
  fileUrls: Record<string, string>;
};

const SIGNED_URL_SECONDS = 60 * 60;
const CARD_COLUMNS = "id, code, card_answers, risk_tag, position";

type SlotRow = {
  key: string;
  tier: InterviewQuestion["tier"];
  card_group: string | null;
  suggested_answer: InterviewQuestion["suggested_answer"];
  schedule_day: string;
  question: string;
  answer_type: InterviewQuestion["answer_type"];
  condition: string;
  card_source: string;
};

async function loadBankParts(supabase: Awaited<ReturnType<typeof createSessionClient>>) {
  const [slots, days, settings] = await Promise.all([
    supabase
      .from("rule_slots")
      .select("key, tier, card_group, suggested_answer, schedule_day, question, answer_type, condition, card_source")
      .order("position"),
    supabase.from("schedule_days").select("code, title, condition").order("week").order("day"),
    supabase.from("settings").select("key, value").in("key", ["conditions", "gray_card_questions", "card_group_order"]),
  ]);
  for (const r of [slots, days, settings]) if (r.error) throw r.error;
  const setting = (key: string) => settings.data?.find((s) => s.key === key)?.value;
  return {
    questions: ((slots.data ?? []) as SlotRow[]).map(
      (s): InterviewQuestion => ({
        key: s.key,
        tier: s.tier,
        card_group: s.card_group,
        suggested_answer: s.suggested_answer,
        quiz: s.schedule_day,
        question: s.question,
        answer_type: s.answer_type,
        condition: s.condition,
        source: s.card_source,
      }),
    ),
    quizzes: (days.data ?? []) as QuizInfo[],
    conditions: (setting("conditions") ?? {}) as Record<string, string>,
    grayCardQuestions: (setting("gray_card_questions") ?? []) as GrayCardQuestion[],
    cardGroupOrder: (setting("card_group_order") ?? []) as string[],
  };
}

type CardRow = { id: string; code: string; card_answers: Record<string, string>; risk_tag: GrayCard["risk_tag"]; position: number };
type DbRule = Omit<RuleRow, "document_name"> & { office_id: string; office_documents: { file_name: string } | null };

const RULE_COLUMNS =
  "id, office_id, rule_slot_key, rule, attachments, source, source_document_id, source_quote, status, " +
  "doctor_approved_at, office_documents(file_name)";

const toRule = (r: DbRule): RuleRow => ({
  id: r.id,
  rule_slot_key: r.rule_slot_key,
  rule: r.rule,
  attachments: r.attachments ?? [],
  source: r.source,
  source_document_id: r.source_document_id,
  source_quote: r.source_quote,
  status: r.status,
  doctor_approved_at: r.doctor_approved_at,
  document_name: r.office_documents?.file_name ?? null,
});

// Answers are the direct rules (no source document).
const toAnswers = (rows: RuleRow[]) =>
  Object.fromEntries(
    rows.filter((r) => r.source_document_id === null).map((r) => [r.rule_slot_key, { value: r.rule, attachments: r.attachments }]),
  ) as Record<string, Answer>;

const toCard = (c: CardRow): GrayCard => ({
  id: c.id,
  code: c.code,
  answers: c.card_answers ?? {},
  risk_tag: c.risk_tag,
  position: c.position,
});

type Supabase = Awaited<ReturnType<typeof createSessionClient>>;
type BankParts = Awaited<ReturnType<typeof loadBankParts>>;

function flowFor(bank: BankParts, rules: RuleRow[], grayCards: GrayCard[], documentCount: number) {
  return buildDoctorFlow({
    slots: bank.questions,
    dayConditions: Object.fromEntries(bank.quizzes.map((q) => [q.code, q.condition])),
    conditions: bank.conditions,
    cardGroupOrder: bank.cardGroupOrder,
    profile: profileFromAnswers(toAnswers(rules)),
    rules,
    documentCount,
    grayCards,
    grayCardQuestions: bank.grayCardQuestions,
  });
}

async function signedUrls(supabase: Supabase, rules: RuleRow[]) {
  // Short-lived links to view uploaded files (the bucket is private).
  const paths = rules.flatMap((r) => r.attachments.map((f) => f.path));
  const fileUrls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const item of data ?? []) if (item.path && item.signedUrl) fileUrls[item.path] = item.signedUrl;
  }
  return fileUrls;
}

// Everything about one office: setup data plus the doctor's flow.
export async function loadOfficeSetup(officeId: string) {
  const supabase = await createSessionClient();
  const { data: office, error } = await supabase
    .from("offices")
    .select("id, name, status")
    .eq("id", officeId)
    .maybeSingle();
  if (error) throw error;
  if (!office) return null;

  const [bank, rules, cards, documents] = await Promise.all([
    loadBankParts(supabase),
    supabase.from("office_rules").select(RULE_COLUMNS).eq("office_id", officeId),
    supabase.from("office_workflows").select(CARD_COLUMNS).eq("office_id", officeId).order("position"),
    supabase.from("office_documents").select("id", { count: "exact", head: true }).eq("office_id", officeId),
  ]);
  for (const r of [rules, cards, documents]) if (r.error) throw r.error;

  const ruleRows = ((rules.data ?? []) as unknown as DbRule[]).map(toRule);
  const grayCards = ((cards.data ?? []) as CardRow[]).map(toCard);
  const interview: InterviewData = {
    office,
    ...bank,
    answers: toAnswers(ruleRows),
    sources: Object.fromEntries(
      ruleRows
        .filter((r) => r.source_document_id === null)
        .map((r) => [r.rule_slot_key, { source: r.source, status: r.status }]),
    ),
    grayCards,
    fileUrls: await signedUrls(supabase, ruleRows),
  };
  return { interview, flow: flowFor(bank, ruleRows, grayCards, documents.count ?? 0) };
}

export type OfficeRow = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  doctors: { name: string; email: string }[];
  steps: Step[];
};

// Offices list for VFDA admins, with the doctor's setup steps per office.
export async function loadOffices(): Promise<OfficeRow[]> {
  const supabase = await createSessionClient();
  const [offices, doctors, rules, cards, documents, bank] = await Promise.all([
    supabase.from("offices").select("id, name, status, created_at").order("created_at"),
    supabase.from("profiles").select("office_id, full_name, email").eq("role", "doctor"),
    supabase.from("office_rules").select(RULE_COLUMNS),
    supabase.from("office_workflows").select(`office_id, ${CARD_COLUMNS}`),
    supabase.from("office_documents").select("office_id"),
    loadBankParts(supabase),
  ]);
  for (const r of [offices, doctors, rules, cards, documents]) if (r.error) throw r.error;

  const allRules = (rules.data ?? []) as unknown as DbRule[];
  return (offices.data ?? []).map((office) => {
    const officeRules = allRules.filter((r) => r.office_id === office.id).map(toRule);
    const officeCards = ((cards.data ?? []) as (CardRow & { office_id: string })[])
      .filter((c) => c.office_id === office.id)
      .map(toCard);
    const documentCount = (documents.data ?? []).filter((d) => d.office_id === office.id).length;
    return {
      id: office.id,
      name: office.name,
      status: office.status,
      createdAt: office.created_at,
      doctors: (doctors.data ?? [])
        .filter((d) => d.office_id === office.id)
        .map((d) => ({ name: d.full_name, email: d.email })),
      steps: flowFor(bank, officeRules, officeCards, documentCount).steps,
    };
  });
}

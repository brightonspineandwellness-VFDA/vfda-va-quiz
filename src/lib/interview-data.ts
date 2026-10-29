import "server-only";

import {
  buildSections,
  computeProgress,
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
  grayCards: GrayCard[];
  fileUrls: Record<string, string>;
};

const SIGNED_URL_SECONDS = 60 * 60;
const CARD_COLUMNS = "id, code, card_answers, risk_tag, position";

type SlotRow = {
  key: string;
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
      .select("key, schedule_day, question, answer_type, condition, card_source")
      .order("position"),
    supabase.from("schedule_days").select("code, title, condition").order("week").order("day"),
    supabase.from("settings").select("key, value").in("key", ["conditions", "gray_card_questions"]),
  ]);
  for (const r of [slots, days, settings]) if (r.error) throw r.error;
  const setting = (key: string) => settings.data?.find((s) => s.key === key)?.value;
  return {
    questions: ((slots.data ?? []) as SlotRow[]).map(
      (s): InterviewQuestion => ({
        key: s.key,
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
  };
}

type RuleRow = { office_id: string; rule_slot_key: string; rule: Answer["value"]; attachments: Answer["attachments"] };
type CardRow = { id: string; code: string; card_answers: Record<string, string>; risk_tag: GrayCard["risk_tag"]; position: number };

const toAnswers = (rows: RuleRow[]) =>
  Object.fromEntries(
    rows.map((r) => [r.rule_slot_key, { value: r.rule, attachments: r.attachments ?? [] }]),
  ) as Record<string, Answer>;

const toCard = (c: CardRow): GrayCard => ({
  id: c.id,
  code: c.code,
  answers: c.card_answers ?? {},
  risk_tag: c.risk_tag,
  position: c.position,
});

export async function loadInterview(officeId: string): Promise<InterviewData | null> {
  const supabase = await createSessionClient();
  const { data: office, error } = await supabase
    .from("offices")
    .select("id, name, status")
    .eq("id", officeId)
    .maybeSingle();
  if (error) throw error;
  if (!office) return null;

  const [bank, rules, cards] = await Promise.all([
    loadBankParts(supabase),
    supabase
      .from("office_rules")
      .select("office_id, rule_slot_key, rule, attachments")
      .eq("office_id", officeId)
      .is("source_document_id", null),
    supabase.from("office_workflows").select(CARD_COLUMNS).eq("office_id", officeId).order("position"),
  ]);
  if (rules.error) throw rules.error;
  if (cards.error) throw cards.error;

  const answerMap = toAnswers((rules.data ?? []) as RuleRow[]);

  // Short-lived links to view uploaded files (the bucket is private).
  const paths = Object.values(answerMap).flatMap((a) => a.attachments.map((f) => f.path));
  const fileUrls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const item of data ?? []) if (item.path && item.signedUrl) fileUrls[item.path] = item.signedUrl;
  }

  return {
    office,
    ...bank,
    answers: answerMap,
    grayCards: ((cards.data ?? []) as CardRow[]).map(toCard),
    fileUrls,
  };
}

export type OfficeRow = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  doctors: { name: string; email: string }[];
  progress: { done: number; total: number; percent: number };
};

// Offices list for VFDA admins, with setup progress per office.
export async function loadOffices(): Promise<OfficeRow[]> {
  const supabase = await createSessionClient();
  const [offices, doctors, rules, cards, bank] = await Promise.all([
    supabase.from("offices").select("id, name, status, created_at").order("created_at"),
    supabase.from("profiles").select("office_id, full_name, email").eq("role", "doctor"),
    supabase
      .from("office_rules")
      .select("office_id, rule_slot_key, rule, attachments")
      .is("source_document_id", null),
    supabase.from("office_workflows").select(`office_id, ${CARD_COLUMNS}`),
    loadBankParts(supabase),
  ]);
  for (const r of [offices, doctors, rules, cards]) if (r.error) throw r.error;

  return (offices.data ?? []).map((office) => {
    const officeAnswers = toAnswers(((rules.data ?? []) as RuleRow[]).filter((a) => a.office_id === office.id));
    const officeCards = ((cards.data ?? []) as (CardRow & { office_id: string })[])
      .filter((c) => c.office_id === office.id)
      .map(toCard);
    const profile = profileFromAnswers(officeAnswers);
    const sections = buildSections(bank.questions, bank.quizzes, bank.conditions, profile);
    const { done, total, percent } = computeProgress(
      sections,
      officeAnswers,
      profile,
      officeCards,
      bank.grayCardQuestions,
    );
    return {
      id: office.id,
      name: office.name,
      status: office.status,
      createdAt: office.created_at,
      doctors: (doctors.data ?? [])
        .filter((d) => d.office_id === office.id)
        .map((d) => ({ name: d.full_name, email: d.email })),
      progress: { done, total, percent },
    };
  });
}

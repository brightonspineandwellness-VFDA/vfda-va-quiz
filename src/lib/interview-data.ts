import "server-only";

import {
  buildDoctorFlow,
  mustAskFallbacks,
  type DocumentRow,
  type FlowInput,
  type MissingCard,
  type OfficeState,
  type RuleRow,
  type Step,
} from "@/lib/doctor-flow";
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
  // by: who answered it (any doctor of the office, or VFDA), and when.
  sources: Record<string, { source: RuleRow["source"]; status: RuleRow["status"]; by?: string | null; at?: string | null }>;
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
    supabase.from("settings").select("key, value").in("key", ["conditions", "gray_card_questions"]),
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
  };
}

type CardRow = { id: string; code: string; card_answers: Record<string, string>; risk_tag: GrayCard["risk_tag"]; position: number };
type DbRule = Omit<RuleRow, "document_name"> & { office_id: string; office_documents: { file_name: string } | null };

const RULE_COLUMNS =
  "id, office_id, rule_slot_key, rule, attachments, source, source_document_id, source_quote, status, partial, " +
  "doctor_approved_at, doctor_approved_by, office_documents(file_name)";
const OFFICE_STATE_COLUMNS =
  "cards_uploaded_at, extraction_status, extraction_error, sent_to_doctor_at, standards_accepted_at, standards_accepted_by, primary_doctor_id";
const DOCUMENT_COLUMNS =
  "id, office_id, file_name, card_name, file_path, imported_at, created_at, card_title, card_color, schedule_days, workflow, skip, tags, mapped_at, uploaded_by";

type DbOffice = {
  cards_uploaded_at: string | null;
  extraction_status: OfficeState["extractionStatus"];
  extraction_error: string | null;
  sent_to_doctor_at: string | null;
  standards_accepted_at: string | null;
  standards_accepted_by?: string | null;
};
const toState = (o: DbOffice): OfficeState => ({
  cardsUploadedAt: o.cards_uploaded_at,
  extractionStatus: o.extraction_status,
  sentToDoctorAt: o.sent_to_doctor_at,
  extractionError: o.extraction_error,
  standardsAcceptedAt: o.standards_accepted_at,
  standardsAcceptedBy: o.standards_accepted_by ?? null,
});

const toRule = (r: DbRule): RuleRow => ({
  id: r.id,
  rule_slot_key: r.rule_slot_key,
  rule: r.rule,
  attachments: r.attachments ?? [],
  source: r.source,
  source_document_id: r.source_document_id,
  source_quote: r.source_quote,
  status: r.status,
  partial: r.partial ?? false,
  doctor_approved_at: r.doctor_approved_at,
  doctor_approved_by: r.doctor_approved_by ?? null,
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

function flowInput(
  bank: BankParts,
  rules: RuleRow[],
  office: OfficeState,
  documents: DocumentRow[],
  missingCards: MissingCard[] = [],
): FlowInput {
  return {
    slots: bank.questions,
    dayConditions: Object.fromEntries(bank.quizzes.map((q) => [q.code, q.condition])),
    conditions: bank.conditions,
    profile: profileFromAnswers(toAnswers(rules)),
    rules,
    office,
    documents,
    missingCards,
  };
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

type Person = { id: string; full_name: string | null; email: string };

// A user id as a name: the office's doctors by name; anyone else (a VFDA
// admin, whom doctors can't look up) as "VFDA".
const whoDid = (doctors: Person[]) => (id: string | null | undefined) => {
  if (!id) return null;
  const d = doctors.find((p) => p.id === id);
  return d ? d.full_name?.trim() || d.email : "VFDA";
};

// Everything about one office: setup data plus the doctor's flow. As the
// signed-in user, or with the client given (the service role, for work done
// after a response, e.g. the SOP gap report).
export async function loadOfficeSetup(officeId: string, client?: Supabase) {
  const supabase = client ?? (await createSessionClient());
  const { data: office, error } = await supabase
    .from("offices")
    .select(`id, name, status, ${OFFICE_STATE_COLUMNS}`)
    .eq("id", officeId)
    .maybeSingle();
  if (error) throw error;
  if (!office) return null;

  const [bank, rules, cards, documents, people, absences] = await Promise.all([
    loadBankParts(supabase),
    supabase.from("office_rules").select(RULE_COLUMNS).eq("office_id", officeId),
    supabase.from("office_workflows").select(CARD_COLUMNS).eq("office_id", officeId).order("position"),
    supabase.from("office_documents").select(DOCUMENT_COLUMNS).eq("office_id", officeId).eq("kind", "card").order("created_at"),
    // Doctors only see released questions (row-level security); VFDA sees all.
    // The office's people (removed doctors too), to say who did what.
    supabase.from("profiles").select("id, full_name, email").eq("office_id", officeId),
    supabase.from("office_card_absences").select("card_name, marked_by, marked_at").eq("office_id", officeId),
  ]);
  for (const r of [rules, cards, documents]) if (r.error) throw r.error;
  const who = whoDid((people.data ?? []) as Person[]);

  const ruleRows = ((rules.data ?? []) as unknown as DbRule[]).map(toRule);
  const grayCards = ((cards.data ?? []) as CardRow[]).map(toCard);
  const interview: InterviewData = {
    office: { id: office.id, name: office.name, status: office.status },
    ...bank,
    answers: toAnswers(ruleRows),
    sources: Object.fromEntries(
      ruleRows
        .filter((r) => r.source_document_id === null)
        .map((r) => [
          r.rule_slot_key,
          { source: r.source, status: r.status, by: who(r.doctor_approved_by), at: r.doctor_approved_by ? r.doctor_approved_at : null },
        ]),
    ),
    grayCards,
    fileUrls: await signedUrls(supabase, ruleRows),
  };
  const state = { ...toState(office as DbOffice), standardsAcceptedBy: who((office as DbOffice).standards_accepted_by) };
  const documentRows = ((documents.data ?? []) as DocumentRow[]).map((d) => ({ ...d, uploaded_by_name: who(d.uploaded_by) }));
  const missingCards = ((absences.data ?? []) as MissingCard[]).map((m) => ({ ...m, marked_by_name: who(m.marked_by) }));
  const input = flowInput(bank, ruleRows, state, documentRows, missingCards);
  return {
    interview,
    state,
    rules: ruleRows,
    documents: documentRows,
    missingCards,
    flow: buildDoctorFlow(input),
    // Must-ask rules no card covers, still to be set to VFDA's suggestion.
    fallbacks: mustAskFallbacks(input),
  };
}

export type OfficeRow = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  // Primary doctor first.
  doctors: { name: string; email: string; primary: boolean }[];
  steps: Step[];
};

// Offices list for VFDA admins, with the doctor's setup steps per office.
export async function loadOffices(): Promise<OfficeRow[]> {
  const supabase = await createSessionClient();
  const [offices, doctors, rules, documents, bank, absences] = await Promise.all([
    supabase.from("offices").select(`id, name, status, created_at, ${OFFICE_STATE_COLUMNS}`).order("created_at"),
    supabase.from("profiles").select("id, office_id, full_name, email").eq("role", "doctor"),
    supabase.from("office_rules").select(RULE_COLUMNS),
    supabase.from("office_documents").select(DOCUMENT_COLUMNS).eq("kind", "card"),
    loadBankParts(supabase),
    supabase.from("office_card_absences").select("office_id, card_name, marked_at"),
  ]);
  for (const r of [offices, doctors, rules, documents]) if (r.error) throw r.error;

  const allRules = (rules.data ?? []) as unknown as DbRule[];
  return (offices.data ?? []).map((office) => {
    const officeRules = allRules.filter((r) => r.office_id === office.id).map(toRule);
    const mine = <T extends { office_id: string }>(rows: T[] | null) => (rows ?? []).filter((r) => r.office_id === office.id);
    return {
      id: office.id,
      name: office.name,
      status: office.status,
      createdAt: office.created_at,
      doctors: (doctors.data ?? [])
        .filter((d) => d.office_id === office.id)
        .map((d) => ({ name: d.full_name, email: d.email, primary: d.id === office.primary_doctor_id }))
        .sort((a, b) => Number(b.primary) - Number(a.primary)),
      steps: buildDoctorFlow(
        flowInput(
        bank,
        officeRules,
        toState(office),
        mine(documents.data as (DocumentRow & { office_id: string })[]),
        mine(absences.data as (MissingCard & { office_id: string })[]),
        ),
      ).steps,
    };
  });
}

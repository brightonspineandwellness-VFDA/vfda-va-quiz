// The doctor's setup flow, worked out from the office's state and rules.
// Shared by the server (pages, actions, office list) and tests; no
// server-only imports.
//
//   1 Profile               the 8 profile-tier questions
//   2 Upload your cards     card PDFs; "Done uploading" reads them
//   3 Waiting for VFDA      reading, card mapping, VFDA review and "Send to doctor"
//   4 Questions for you     only the 12 must-ask rules the cards don't cover,
//                           with the VFDA suggestion to confirm or change
//   5 VFDA standards        one checkbox: anything the cards don't cover uses them
// Steps 4-5 stay locked until VFDA sends the reviewed rules. The cards are the
// source of the office's scenarios; every other rule slot is no longer asked.

import {
  applies,
  isAnswered,
  type Answer,
  type AnswerValue,
  type Attachment,
  type InterviewQuestion,
  type Profile,
} from "@/lib/interview";
import { isMustAsk } from "@/lib/card-map";

export type RuleRow = {
  id: string;
  rule_slot_key: string;
  rule: AnswerValue;
  attachments: Attachment[];
  source: "card_import" | "doctor" | "vfda_default" | "vfda" | "auto";
  source_document_id: string | null;
  source_quote: string | null;
  status: "proposed" | "accepted" | "needs_doctor" | "rejected";
  partial: boolean;
  doctor_approved_at: string | null;
  document_name: string | null;
};

export type ExtractionStatus = "none" | "running" | "done" | "failed";

export type OfficeState = {
  cardsUploadedAt: string | null;
  extractionStatus: ExtractionStatus;
  sentToDoctorAt: string | null;
  extractionError?: string | null;
  standardsAcceptedAt?: string | null;
};

export type DocumentRow = {
  id: string;
  file_name: string;
  card_name: string;
  file_path: string;
  imported_at: string | null;
  created_at: string;
  // Card mapping, once the card has been read.
  card_title?: string;
  card_color?: string | null;
  schedule_days?: string[];
  workflow?: string | null;
  skip?: boolean;
  tags?: string[];
  mapped_at?: string | null;
};

export type GapReason = "not_found" | "partial" | "conflicting" | "edge_case";

export type GapRow = {
  id: string;
  rule_slot_key: string | null;
  workflow: string | null;
  question: string;
  reason: GapReason;
  answer: AnswerValue;
  answered_at: string | null;
  released_at: string | null;
};

// The Trello cards a doctor uploads, in the order of the card groups they feed.
export const CARD_CHECKLIST = [
  { name: "VA Onboarding", group: "VA Onboarding & Basics", note: "" },
  { name: "Open & Close", group: "Open & Close Daily List", note: "" },
  { name: "Patient Journey", group: "Patient Journey", note: "" },
  { name: "New Patient Checklist", group: "New Patient Checklist", note: "" },
  { name: "Re-exam", group: "Re-exam Checklist", note: "if you have a re-exam card" },
  { name: "Scheduling Cadence", group: "Scheduling Cadence", note: "" },
  { name: "Texting & Phone Scripts", group: "Texting & Phone Scripts", note: "" },
  { name: "Slack", group: "Slack & Remote Access", note: "" },
  { name: "Insurance & Billing", group: "Insurance & Billing", note: "if your office bills insurance" },
  { name: "Gray cards", group: null, note: "any extra cards, one PDF each" },
] as const;

// What the cards (after VFDA review) say about one doctor-tier slot.
export type SlotFinding =
  | { kind: "answered"; row: RuleRow } // the doctor (or VFDA) already gave the rule
  | { kind: "found"; row: RuleRow; cards: RuleRow[] }
  | { kind: "partial"; versions: RuleRow[] }
  | { kind: "conflicting"; versions: RuleRow[] }
  | { kind: "not_found" };

export type QuestionItem = { gap: GapRow; slot: InterviewQuestion | null; versions: RuleRow[] };

// A VFDA standard and the office's value for it: a card's version (accepted
// by VFDA) wins over the VFDA default, and the doctor's own answer over both.
export type StandardItem = { slot: InterviewQuestion; row: RuleRow | null };

export type StepKey = "profile" | "upload" | "review" | "questions" | "standards";
export type StepState = "done" | "todo" | "waiting" | "locked";
export type Step = { key: StepKey; label: string; href: string; state: StepState; detail: string };

export type FlowInput = {
  slots: InterviewQuestion[];
  dayConditions: Record<string, string>;
  conditions: Record<string, string>;
  profile: Profile;
  rules: RuleRow[];
  office: OfficeState;
  documents: DocumentRow[];
  gaps: GapRow[];
};

// Card versions VFDA approved ('needs_doctor') or the doctor already accepted.
const isReviewedCard = (r: RuleRow) => r.source === "card_import" && (r.status === "needs_doctor" || r.status === "accepted");
const sameValue = (a: AnswerValue, b: AnswerValue) => JSON.stringify(a) === JSON.stringify(b);
const asAnswer = (r: RuleRow): Answer => ({ value: r.rule, attachments: r.attachments ?? [] });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function slotApplies(slot: InterviewQuestion, input: Pick<FlowInput, "dayConditions" | "conditions" | "profile">) {
  const day = input.dayConditions[slot.quiz] ?? "always";
  return applies(day, input.conditions, input.profile) && applies(slot.condition, input.conditions, input.profile);
}

// A rule the doctor or VFDA typed in. Extraction never overwrites these and
// they never become gap questions.
export function directAnswer(slot: InterviewQuestion, rows: RuleRow[]) {
  const direct = rows.find((r) => r.source_document_id === null && (r.source === "doctor" || r.source === "vfda"));
  return direct && isAnswered(slot, asAnswer(direct)) ? direct : null;
}

export function slotFinding(slot: InterviewQuestion, rows: RuleRow[]): SlotFinding {
  const answered = directAnswer(slot, rows);
  if (answered) return { kind: "answered", row: answered };
  const cards = rows.filter(isReviewedCard);
  const versions = cards.filter((c, i) => cards.findIndex((d) => sameValue(d.rule, c.rule)) === i);
  if (versions.length === 0) return { kind: "not_found" };
  if (versions.length > 1) return { kind: "conflicting", versions };
  if (cards.every((c) => c.partial)) return { kind: "partial", versions };
  return { kind: "found", row: versions[0], cards };
}

function groupRows(rules: RuleRow[]) {
  const byKey = new Map<string, RuleRow[]>();
  for (const r of rules) byKey.set(r.rule_slot_key, [...(byKey.get(r.rule_slot_key) ?? []), r]);
  return (key: string) => byKey.get(key) ?? [];
}

// Only the must-ask rules are still asked of the doctor.
const askedSlots = (input: Pick<FlowInput, "slots" | "dayConditions" | "conditions" | "profile">) =>
  input.slots.filter((s) => s.tier === "doctor" && isMustAsk(s.key) && slotApplies(s, input));

// What "Send to doctor" changes in gap_questions: one question per must-ask
// rule still missing from the cards (not found, partial or conflicting).
// Answered questions are never asked again; open ones whose rule is now
// settled, and any other open question, go away.
export function planGaps(input: Pick<FlowInput, "slots" | "dayConditions" | "conditions" | "profile" | "rules" | "gaps">) {
  const rowsFor = groupRows(input.rules);
  const add: { rule_slot_key: string; question: string; reason: GapReason }[] = [];
  const update: { id: string; reason: GapReason }[] = [];
  const remove: string[] = [];
  for (const slot of askedSlots(input)) {
    const finding = slotFinding(slot, rowsFor(slot.key));
    const existing = input.gaps.find((g) => g.rule_slot_key === slot.key);
    const reason = finding.kind === "answered" || finding.kind === "found" ? null : finding.kind;
    if (existing?.answered_at) continue;
    if (!reason) {
      if (existing) remove.push(existing.id);
    } else if (!existing) {
      add.push({ rule_slot_key: slot.key, question: slot.question, reason });
    } else if (existing.reason !== reason) {
      update.push({ id: existing.id, reason });
    }
  }
  // Open questions for anything else (no longer asked, or no longer applies) go away.
  const applicable = new Set(askedSlots(input).map((s) => s.key));
  for (const g of input.gaps) {
    if (!g.answered_at && (!g.rule_slot_key || !applicable.has(g.rule_slot_key))) remove.push(g.id);
  }
  return { add, update, remove };
}

export function buildDoctorFlow(input: FlowInput) {
  const rowsFor = groupRows(input.rules);
  const directFor = (key: string) => {
    const d = rowsFor(key).find((r) => r.source_document_id === null);
    return d ? asAnswer(d) : undefined;
  };
  const unlocked = input.office.sentToDoctorAt !== null;

  // Step 1
  const profileSlots = input.slots.filter((s) => s.tier === "profile");
  const answered = profileSlots.filter((s) => isAnswered(s, directFor(s.key))).length;
  const profileDone = answered === profileSlots.length;

  // Step 2: uploads newer than the last "Done uploading" still need it pressed.
  const uploadedAt = input.office.cardsUploadedAt;
  const newDocuments = input.documents.filter((d) => !uploadedAt || Date.parse(d.created_at) > Date.parse(uploadedAt));
  const uploadDone = uploadedAt !== null && newDocuments.length === 0;

  // Step 3
  const awaitingReview = input.rules.some((r) => r.source === "card_import" && r.status === "proposed");
  const extracting = input.office.extractionStatus === "running" || input.office.extractionStatus === "failed";
  const reviewPending = uploadedAt !== null && (!unlocked || extracting || awaitingReview);

  // Step 4: released must-ask questions, open ones first.
  const slotByKey = new Map(input.slots.map((s) => [s.key, s]));
  const questions: QuestionItem[] = input.gaps
    .filter((g) => g.released_at !== null && isMustAsk(g.rule_slot_key))
    .map((gap) => ({
      gap,
      slot: gap.rule_slot_key ? (slotByKey.get(gap.rule_slot_key) ?? null) : null,
      versions:
        gap.rule_slot_key && (gap.reason === "conflicting" || gap.reason === "partial")
          ? rowsFor(gap.rule_slot_key).filter(isReviewedCard)
          : [],
    }))
    .sort((a, b) => Number(a.gap.answered_at !== null) - Number(b.gap.answered_at !== null));
  const openQuestions = questions.filter((q) => q.gap.answered_at === null).length;

  // Step 5: the VFDA standards, accepted all at once.
  const sourceRank = (r: RuleRow) => (r.source === "doctor" || r.source === "vfda" ? 2 : r.source === "card_import" ? 1 : 0);
  const standards: StandardItem[] = input.slots
    .filter((s) => s.tier === "default" && slotApplies(s, input))
    .map((slot) => {
      const rows = rowsFor(slot.key).filter((r) => r.status !== "rejected" && r.status !== "proposed");
      const row = [...rows].sort((a, b) => sourceRank(b) - sourceRank(a))[0] ?? null;
      return { slot, row };
    });
  const standardsAccepted = !!input.office.standardsAcceptedAt;

  const locked = (step: Omit<Step, "state" | "detail">, open: Pick<Step, "state" | "detail">): Step =>
    unlocked ? { ...step, ...open } : { ...step, state: "locked", detail: "Opens after VFDA review" };

  const steps: Step[] = [
    {
      key: "profile",
      label: "Profile",
      href: "/doctor/setup",
      state: profileDone ? "done" : "todo",
      detail: profileDone ? "Done" : `${answered} of ${profileSlots.length} answered`,
    },
    {
      key: "upload",
      label: "Upload your cards",
      href: "/doctor/setup/upload",
      state: uploadDone ? "done" : "todo",
      detail: uploadDone
        ? plural(input.documents.length, "card") + " uploaded"
        : uploadedAt && newDocuments.length
          ? `${plural(newDocuments.length, "new card")}: press Done uploading`
          : input.documents.length
            ? `${plural(input.documents.length, "card")}: press Done uploading`
            : "Not started",
    },
    {
      key: "review",
      label: "Waiting for VFDA review",
      href: "/doctor/setup/review",
      state: !uploadedAt ? "locked" : reviewPending ? "waiting" : "done",
      detail: !uploadedAt
        ? "After you upload"
        : !reviewPending
          ? "Done"
          : extracting && input.office.extractionStatus === "running"
            ? "Reading your cards"
            : unlocked
              ? "Reviewing new cards"
              : "VFDA is reviewing",
    },
    locked(
      { key: "questions", label: "Questions for you", href: "/doctor/setup/questions" },
      openQuestions === 0 ? { state: "done", detail: "Done" } : { state: "todo", detail: plural(openQuestions, "question") },
    ),
    locked(
      { key: "standards", label: "VFDA standards", href: "/doctor/setup/standards" },
      standardsAccepted ? { state: "done", detail: "Accepted" } : { state: "todo", detail: "Not accepted yet" },
    ),
  ];

  return {
    steps,
    unlocked,
    questions,
    openQuestions,
    standards,
    standardsAccepted,
    newDocuments,
    awaitingReview,
    profileAnswered: answered,
    profileTotal: profileSlots.length,
  };
}

export type DoctorFlow = ReturnType<typeof buildDoctorFlow>;

// The step an office is on: the first one not done.
export function currentStep(steps: Step[]) {
  const index = steps.findIndex((s) => s.state !== "done");
  return index < 0 ? null : { index, step: steps[index] };
}

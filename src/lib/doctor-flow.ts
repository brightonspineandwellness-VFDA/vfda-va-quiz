// The doctor's setup flow, worked out from the office's state and rules.
// Shared by the server (pages, actions, office list) and tests; no
// server-only imports.
//
//   1 Profile               the 8 profile-tier questions
//   2 Upload your cards     card PDFs; "Done uploading" starts extraction
//   3 Waiting for VFDA      extraction, then VFDA review and "Send to doctor"
//   4 Confirm your rules    doctor-tier rules found on the cards, per card group
//   5 Questions for you     gap questions only (not found, partial, conflicting, edge cases)
//   6 VFDA standards        default-tier rules, pre-accepted as vfda_default
// Steps 4-6 stay locked until VFDA sends the reviewed rules. Auto-tier rules
// never appear here.

import {
  applies,
  isAnswered,
  type Answer,
  type AnswerValue,
  type Attachment,
  type InterviewQuestion,
  type Profile,
} from "@/lib/interview";

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
};

export type DocumentRow = {
  id: string;
  file_name: string;
  card_name: string;
  file_path: string;
  imported_at: string | null;
  created_at: string;
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

export type ConfirmItem =
  | { kind: "card"; slot: InterviewQuestion; row: RuleRow; confirmed: boolean; confirmIds: string[] }
  | { kind: "answered"; slot: InterviewQuestion; row: RuleRow };

export type ConfirmGroup = { name: string; slug: string; items: ConfirmItem[]; confirmed: boolean };

export type QuestionItem = { gap: GapRow; slot: InterviewQuestion | null; versions: RuleRow[] };

export type StandardItem = {
  slot: InterviewQuestion;
  row: RuleRow | null;
  override: RuleRow | null; // a card that says something different, waiting for the doctor
  accepted: boolean;
};

export type StepKey = "profile" | "upload" | "review" | "confirm" | "questions" | "standards";
export type StepState = "done" | "todo" | "waiting" | "locked";
export type Step = { key: StepKey; label: string; href: string; state: StepState; detail: string };

export type FlowInput = {
  slots: InterviewQuestion[];
  dayConditions: Record<string, string>;
  conditions: Record<string, string>;
  cardGroupOrder: string[];
  profile: Profile;
  rules: RuleRow[];
  office: OfficeState;
  documents: DocumentRow[];
  gaps: GapRow[];
};

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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

const doctorSlots = (input: FlowInput) => input.slots.filter((s) => s.tier === "doctor" && slotApplies(s, input));

// What "Send to doctor" changes in gap_questions: one question per doctor-tier
// slot that is still missing (not found, partial or conflicting). Answered
// questions are never asked again; open ones whose slot is now settled go away.
export function planGaps(input: Pick<FlowInput, "slots" | "dayConditions" | "conditions" | "profile" | "rules" | "gaps">) {
  const rowsFor = groupRows(input.rules);
  const add: { rule_slot_key: string; question: string; reason: GapReason }[] = [];
  const update: { id: string; reason: GapReason }[] = [];
  const remove: string[] = [];
  for (const slot of doctorSlots(input as FlowInput)) {
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
  // Slots that no longer apply to the office (profile changed) drop their open questions.
  const applicable = new Set(doctorSlots(input as FlowInput).map((s) => s.key));
  for (const g of input.gaps) {
    if (g.rule_slot_key && !g.answered_at && !applicable.has(g.rule_slot_key)) remove.push(g.id);
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

  // Step 4
  const slotsByGroup = doctorSlots(input);
  const groupNames = [
    ...input.cardGroupOrder,
    ...new Set(slotsByGroup.map((s) => s.card_group ?? "Other").filter((g) => !input.cardGroupOrder.includes(g))),
  ];
  const groups: ConfirmGroup[] = groupNames
    .map((name) => {
      const items = slotsByGroup
        .filter((s) => (s.card_group ?? "Other") === name)
        .flatMap((slot): ConfirmItem[] => {
          const finding = slotFinding(slot, rowsFor(slot.key));
          if (finding.kind === "answered") return [{ kind: "answered", slot, row: finding.row }];
          if (finding.kind !== "found") return [];
          return [
            {
              kind: "card",
              slot,
              row: finding.row,
              confirmed: finding.cards.some((c) => c.status === "accepted" && c.doctor_approved_at !== null),
              confirmIds: finding.cards.map((c) => c.id),
            },
          ];
        });
      return {
        name,
        slug: slugify(name),
        items,
        confirmed: items.every((i) => i.kind === "answered" || i.confirmed),
      };
    })
    // Only card groups where the cards had rules.
    .filter((g) => g.items.some((i) => i.kind === "card"));
  const groupsDone = groups.filter((g) => g.confirmed).length;

  // Step 5: released gap questions, open ones first.
  const slotByKey = new Map(input.slots.map((s) => [s.key, s]));
  const questions: QuestionItem[] = input.gaps
    .filter((g) => g.released_at !== null)
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

  // Step 6
  const standards: StandardItem[] = input.slots
    .filter((s) => s.tier === "default" && slotApplies(s, input))
    .map((slot) => {
      const rows = rowsFor(slot.key);
      const row = rows.find((r) => r.source_document_id === null) ?? null;
      const override =
        rows.find((r) => r.source === "card_import" && r.status === "needs_doctor" && (!row || !sameValue(r.rule, row.rule))) ??
        null;
      return { slot, row, override, accepted: !!row?.doctor_approved_at && !override };
    });
  const standardsDone = standards.filter((s) => s.accepted).length;

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
      { key: "confirm", label: "Confirm your rules", href: "/doctor/setup/confirm" },
      groupsDone === groups.length
        ? { state: "done", detail: groups.length ? "Done" : "Nothing to confirm" }
        : { state: "todo", detail: `${groupsDone} of ${plural(groups.length, "group")} confirmed` },
    ),
    locked(
      { key: "questions", label: "Questions for you", href: "/doctor/setup/questions" },
      openQuestions === 0 ? { state: "done", detail: "Done" } : { state: "todo", detail: plural(openQuestions, "question") },
    ),
    locked(
      { key: "standards", label: "VFDA standards", href: "/doctor/setup/standards" },
      standardsDone === standards.length
        ? { state: "done", detail: "Done" }
        : { state: "todo", detail: `${standardsDone} of ${standards.length} accepted` },
    ),
  ];

  return {
    steps,
    unlocked,
    groups,
    questions,
    openQuestions,
    standards,
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

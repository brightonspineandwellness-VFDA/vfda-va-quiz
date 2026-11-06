// The doctor's setup flow, worked out from the office's state and rules.
// Shared by the server (pages, actions, office list) and tests; no
// server-only imports.
//
//   1 Profile               the 8 profile-tier questions
//   2 Upload your cards     card PDFs, or "We don't have this card" for a topic;
//                           "Done uploading" reads them
//   3 VFDA standards        one checkbox: anything the cards don't cover uses them
// The doctor is never asked about rules. Rules read from the cards are the
// office's rules at once (VFDA can correct a misread); a must-ask rule no card
// covers uses VFDA's suggestion (source vfda_default) and goes in VFDA's report.

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
  // doctor_card: the doctor's own answer, read from their VA Office Rules card.
  source: "card_import" | "doctor_card" | "doctor" | "vfda_default" | "vfda" | "auto";
  source_document_id: string | null;
  source_quote: string | null;
  status: "proposed" | "accepted" | "needs_doctor" | "rejected";
  partial: boolean;
  doctor_approved_at: string | null;
  doctor_approved_by?: string | null;
  document_name: string | null;
};

export type ExtractionStatus = "none" | "running" | "done" | "failed";

export type OfficeState = {
  cardsUploadedAt: string | null;
  extractionStatus: ExtractionStatus;
  // Set on offices VFDA sent to the doctor under the old flow.
  sentToDoctorAt?: string | null;
  extractionError?: string | null;
  standardsAcceptedAt?: string | null;
  // Who ticked "VFDA standards" (any doctor of the office).
  standardsAcceptedBy?: string | null;
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
  // Who uploaded it: a doctor of the office (by name) or "VFDA".
  uploaded_by?: string | null;
  uploaded_by_name?: string | null;
};

// A checklist topic the office has no card for ("We don't have this card").
export type MissingCard = { card_name: string; marked_at: string; marked_by?: string | null; marked_by_name?: string | null };

// VFDA's form card: each must-ask rule's question with the doctor's "Our
// answer:" (or "VFDA default"). Its answers are the doctor's own rules.
export const OFFICE_RULES_CARD = "VA Office Rules";

// The Trello cards a doctor uploads, in the order of the card groups they feed.
export const CARD_CHECKLIST = [
  { name: "VA Onboarding", group: "VA Onboarding & Basics", note: "" },
  { name: OFFICE_RULES_CARD, group: null, note: "VFDA's form: your answer to each office rule" },
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

// A VFDA standard and the office's value for it: a card's version wins over
// the VFDA default, and the doctor's own answer over both.
export type StandardItem = { slot: InterviewQuestion; row: RuleRow | null };

export type StepKey = "profile" | "upload" | "standards";
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
  missingCards?: MissingCard[];
};

const asAnswer = (r: RuleRow): Answer => ({ value: r.rule, attachments: r.attachments ?? [] });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Rules read from cards are the office's rules (a rejected misread isn't).
export const isCardRule = (r: RuleRow) => r.source === "card_import" && r.status !== "rejected";

export function slotApplies(slot: InterviewQuestion, input: Pick<FlowInput, "dayConditions" | "conditions" | "profile">) {
  const day = input.dayConditions[slot.quiz] ?? "always";
  return applies(day, input.conditions, input.profile) && applies(slot.condition, input.conditions, input.profile);
}

// A rule the doctor or VFDA typed in. Extraction never overwrites these.
export function directAnswer(slot: InterviewQuestion, rows: RuleRow[]) {
  const direct = rows.find((r) => r.source_document_id === null && (r.source === "doctor" || r.source === "vfda"));
  return direct && isAnswered(slot, asAnswer(direct)) ? direct : null;
}

// The doctor's answer from their VA Office Rules card (the latest card wins).
export function doctorCardAnswer(slot: InterviewQuestion, rows: RuleRow[]) {
  const latest = rows
    .filter((r) => r.source === "doctor_card" && r.status === "accepted" && isAnswered(slot, asAnswer(r)))
    .sort((a, b) => Date.parse(b.doctor_approved_at ?? "") - Date.parse(a.doctor_approved_at ?? "") || 0)[0];
  return latest ?? null;
}

// The doctor's (or VFDA's) own answer: typed in, else from the VA Office Rules
// card. Cards are never read again for these.
export const ownAnswer = (slot: InterviewQuestion, rows: RuleRow[]) => directAnswer(slot, rows) ?? doctorCardAnswer(slot, rows);

function groupRows(rules: RuleRow[]) {
  const byKey = new Map<string, RuleRow[]>();
  for (const r of rules) byKey.set(r.rule_slot_key, [...(byKey.get(r.rule_slot_key) ?? []), r]);
  return (key: string) => byKey.get(key) ?? [];
}

// Must-ask rules no card covers (and nobody answered): they use VFDA's
// suggestion (source vfda_default). Rules VFDA has no suggestion for stay
// blank; VFDA sees them in the report.
export function mustAskFallbacks(input: Pick<FlowInput, "slots" | "dayConditions" | "conditions" | "profile" | "rules">) {
  const rowsFor = groupRows(input.rules);
  return input.slots.filter((s) => {
    if (s.tier !== "doctor" || !isMustAsk(s.key) || !slotApplies(s, input) || s.suggested_answer === null) return false;
    const rows = rowsFor(s.key);
    return !ownAnswer(s, rows) && !rows.some(isCardRule) && !rows.some((r) => r.source === "vfda_default");
  });
}

export function buildDoctorFlow(input: FlowInput) {
  const rowsFor = groupRows(input.rules);
  const directFor = (key: string) => {
    const d = rowsFor(key).find((r) => r.source_document_id === null);
    return d ? asAnswer(d) : undefined;
  };

  // Step 1
  const profileSlots = input.slots.filter((s) => s.tier === "profile");
  const answered = profileSlots.filter((s) => isAnswered(s, directFor(s.key))).length;
  const profileDone = answered === profileSlots.length;

  // Step 2: uploads newer than the last "Done uploading" still need it pressed,
  // and every topic needs a card or "We don't have this card" (offices set up
  // before this existed count as done).
  const uploadedAt = input.office.cardsUploadedAt;
  const newDocuments = input.documents.filter((d) => !uploadedAt || Date.parse(d.created_at) > Date.parse(uploadedAt));
  const missingCards = input.missingCards ?? [];
  const uncoveredTopics = CARD_CHECKLIST.filter(
    (c) => !input.documents.some((d) => d.card_name === c.name) && !missingCards.some((m) => m.card_name === c.name),
  ).map((c) => c.name);
  const uploadDone = uploadedAt !== null && newDocuments.length === 0 && (uncoveredTopics.length === 0 || !!input.office.sentToDoctorAt);
  const reading = input.office.extractionStatus === "running";

  // Step 3: the VFDA standards, accepted all at once.
  const sourceRank = (r: RuleRow) =>
    r.source === "doctor" || r.source === "vfda" ? 3 : r.source === "doctor_card" ? 2 : r.source === "card_import" ? 1 : 0;
  const standards: StandardItem[] = input.slots
    .filter((s) => s.tier === "default" && slotApplies(s, input))
    .map((slot) => {
      const rows = rowsFor(slot.key).filter((r) => r.status !== "rejected" && r.status !== "proposed");
      const row = [...rows].sort((a, b) => sourceRank(b) - sourceRank(a))[0] ?? null;
      return { slot, row };
    });
  const standardsAccepted = !!input.office.standardsAcceptedAt;

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
        ? (reading ? "Reading your cards · " : "") +
          plural(input.documents.length, "card") +
          " uploaded" +
          (missingCards.length ? `, ${plural(missingCards.length, "topic")} without a card` : "")
        : uploadedAt && !newDocuments.length && uncoveredTopics.length
          ? `${plural(uncoveredTopics.length, "topic")} left: upload or mark "We don't have this card"`
          : uploadedAt && newDocuments.length
            ? `${plural(newDocuments.length, "new card")}: press Done uploading`
            : input.documents.length
              ? `${plural(input.documents.length, "card")}: press Done uploading`
              : "Not started",
    },
    {
      key: "standards",
      label: "VFDA standards",
      href: "/doctor/setup/standards",
      state: standardsAccepted ? "done" : "todo",
      detail: standardsAccepted ? "Accepted" : "Not accepted yet",
    },
  ];

  return {
    steps,
    standards,
    standardsAccepted,
    standardsAcceptedAt: input.office.standardsAcceptedAt ?? null,
    standardsAcceptedBy: input.office.standardsAcceptedBy ?? null,
    newDocuments,
    missingCards,
    uncoveredTopics,
    reading,
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

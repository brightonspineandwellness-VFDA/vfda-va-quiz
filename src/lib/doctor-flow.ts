// The doctor's setup flow (settings.doctor_flow), worked out from the office's
// rules. Shared by the server (pages, actions, office list) and tests; no
// server-only imports.
//
//   Step 1 Setup          the 8 profile-tier questions (+ gray cards if any)
//   Step 2 Your cards     doctor-tier rules, one screen per card group
//   Step 3 VFDA standards default-tier rules, pre-accepted as vfda_default
// Auto-tier rules never appear here.

import {
  applies,
  grayCardAnswered,
  isAnswered,
  type Answer,
  type AnswerValue,
  type Attachment,
  type GrayCard,
  type GrayCardQuestion,
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
  doctor_approved_at: string | null;
  document_name: string | null;
};

export type CardItem =
  | {
      kind: "rule";
      slot: InterviewQuestion;
      row: RuleRow; // the rule shown: the direct answer, or the card's version
      confirmed: boolean;
      confirmIds: string[]; // rows "Looks right" accepts
    }
  | {
      kind: "question";
      slot: InterviewQuestion;
      reason: "not_found" | "conflicting";
      versions: RuleRow[]; // conflicting card versions, one per distinct value
    };

export type CardGroup = { name: string; slug: string; items: CardItem[]; confirmed: boolean };

export type StandardItem = {
  slot: InterviewQuestion;
  row: RuleRow | null;
  override: RuleRow | null; // a card that says something different, waiting for the doctor
  accepted: boolean;
};

export type StepState = "done" | "todo" | "waiting";
export type Step = { key: "setup" | "cards" | "standards"; label: string; href: string; state: StepState; detail: string };

export type FlowInput = {
  slots: InterviewQuestion[];
  dayConditions: Record<string, string>;
  conditions: Record<string, string>;
  cardGroupOrder: string[];
  profile: Profile;
  rules: RuleRow[];
  documentCount: number;
  grayCards: GrayCard[];
  grayCardQuestions: GrayCardQuestion[];
};

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Card versions the doctor sees: reviewed by VFDA ('needs_doctor') or already accepted.
const isShownCard = (r: RuleRow) => r.source === "card_import" && (r.status === "needs_doctor" || r.status === "accepted");
const sameValue = (a: AnswerValue, b: AnswerValue) => JSON.stringify(a) === JSON.stringify(b);
const asAnswer = (r: RuleRow): Answer => ({ value: r.rule, attachments: r.attachments ?? [] });

export function slotApplies(slot: InterviewQuestion, input: Pick<FlowInput, "dayConditions" | "conditions" | "profile">) {
  const day = input.dayConditions[slot.quiz] ?? "always";
  return applies(day, input.conditions, input.profile) && applies(slot.condition, input.conditions, input.profile);
}

function cardItem(slot: InterviewQuestion, rows: RuleRow[]): CardItem {
  const direct = rows.find((r) => r.source_document_id === null);
  if (direct && isAnswered(slot, asAnswer(direct))) {
    return { kind: "rule", slot, row: direct, confirmed: direct.doctor_approved_at !== null, confirmIds: [direct.id] };
  }
  const cards = rows.filter(isShownCard);
  const versions = cards.filter((c, i) => cards.findIndex((d) => sameValue(d.rule, c.rule)) === i);
  if (versions.length === 0) return { kind: "question", slot, reason: "not_found", versions: [] };
  if (versions.length > 1) return { kind: "question", slot, reason: "conflicting", versions };
  return {
    kind: "rule",
    slot,
    row: versions[0],
    confirmed: cards.some((c) => c.status === "accepted" && c.doctor_approved_at !== null),
    confirmIds: cards.map((c) => c.id),
  };
}

export function buildDoctorFlow(input: FlowInput) {
  const rulesByKey = new Map<string, RuleRow[]>();
  for (const r of input.rules) rulesByKey.set(r.rule_slot_key, [...(rulesByKey.get(r.rule_slot_key) ?? []), r]);
  const rowsFor = (key: string) => rulesByKey.get(key) ?? [];
  const directAnswer = (key: string) => {
    const d = rowsFor(key).find((r) => r.source_document_id === null);
    return d ? asAnswer(d) : undefined;
  };

  // Step 1
  const profileSlots = input.slots.filter((s) => s.tier === "profile");
  const answered = profileSlots.filter((s) => isAnswered(s, directAnswer(s.key))).length;
  const wantsCards = input.profile.HAS_GRAY_CARDS === "yes";
  const cardsComplete =
    !wantsCards ||
    (input.grayCards.length > 0 &&
      input.grayCards.every((c) => grayCardAnswered(c, input.grayCardQuestions) === input.grayCardQuestions.length));
  const setupDone = answered === profileSlots.length && cardsComplete;

  // Step 2
  const doctorSlots = input.slots.filter((s) => s.tier === "doctor" && slotApplies(s, input));
  const groupNames = [
    ...input.cardGroupOrder,
    ...new Set(doctorSlots.map((s) => s.card_group ?? "Other").filter((g) => !input.cardGroupOrder.includes(g))),
  ];
  const groups: CardGroup[] = groupNames
    .map((name) => {
      const items = doctorSlots
        .filter((s) => (s.card_group ?? "Other") === name)
        .map((s) => cardItem(s, rowsFor(s.key)));
      return {
        name,
        slug: slugify(name),
        items,
        confirmed: items.every((i) => i.kind === "rule" && i.confirmed),
      };
    })
    .filter((g) => g.items.length > 0);
  const awaitingReview = input.rules.some((r) => r.source === "card_import" && r.status === "proposed");
  const cardsReady = input.documentCount > 0 && !awaitingReview;
  const groupsDone = groups.filter((g) => g.confirmed).length;

  // Step 3
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

  const steps: Step[] = [
    {
      key: "setup",
      label: "Setup",
      href: "/doctor/setup",
      state: setupDone ? "done" : "todo",
      detail: setupDone ? "Done" : `${answered} of ${profileSlots.length} answered`,
    },
    {
      key: "cards",
      label: "Your cards",
      href: "/doctor/setup/cards",
      state: groups.length > 0 && groupsDone === groups.length ? "done" : cardsReady ? "todo" : "waiting",
      detail:
        groups.length > 0 && groupsDone === groups.length
          ? "Done"
          : cardsReady
            ? `${groupsDone} of ${groups.length} confirmed`
            : "Waiting for VFDA",
    },
    {
      key: "standards",
      label: "VFDA standards",
      href: "/doctor/setup/standards",
      state: standardsDone === standards.length ? "done" : "todo",
      detail: standardsDone === standards.length ? "Done" : `${standardsDone} of ${standards.length} accepted`,
    },
  ];

  return { steps, groups, cardsReady, awaitingReview, standards, profileAnswered: answered, profileTotal: profileSlots.length };
}

export type DoctorFlow = ReturnType<typeof buildDoctorFlow>;

// Where the rule an item was graded against came from: the office's own card,
// or a VFDA standard (a rule with source vfda_default, the "VFDA standards"
// source, or the master bank with no card). Recorded per item when it's
// graded (attempt_items.rule_source) and shown on the reports as the "Some
// answers were checked against VFDA standards" notice and each coaching
// tip's tag. Pure functions; src/lib/rule-sources.ts loads the data.

import { NO_CARD_SOURCE } from "@/lib/card-map";

export type ItemRuleSource = {
  kind: "card" | "vfda_standard";
  card: string | null; // the office card's name (kind "card")
  // The VFDA standard rules the item relied on, in plain words
  // ("No-show follow-up: call within 15 minutes"). Rules only: never the
  // scenario or an answer.
  rules: string[];
};

// Source names that mean "no office card": the item was written from VFDA's
// standards or master bank (src/lib/scenario-ai.ts, src/lib/card-map.ts).
const VFDA_SOURCES = new Set([NO_CARD_SOURCE, "VFDA standards", "Master bank"].map((s) => s.toLowerCase()));

export const isVfdaSourceCard = (card: string | null | undefined) => !card?.trim() || VFDA_SOURCES.has(card.trim().toLowerCase());

// Short, plain names for the rules most often filled from a VFDA standard.
const RULE_NAMES: Record<string, string> = {
  NO_SHOW_RULE: "No-show follow-up",
  CONFIRM_RULE: "Appointment confirmations",
  SAME_DAY_CUTOFF: "Same-day booking cutoff",
  TEXT_RESPONSE_TIME: "Text response time",
  CALLBACK_TIME: "Returning missed calls",
  ESCALATION_CHANNEL: "Where to send questions",
  ESCALATION_CONTACT: "Who to go to when stuck",
  FOLLOWUP_INTERVAL: "Claim follow-up",
  VA_AUTHORITY: "What the VA can decide alone",
  BILLING_AUTHORITY: "What the VA can post alone",
  PROHIBITED_PHRASES: "What the VA must never say",
  OFFICE_HOURS: "Office hours",
  EMERGENCY_PROTOCOL: "Emergency calls",
  RED_FLAGS: "Red-flag symptoms",
  PATIENT_ID_CHECK: "Checking patient identity",
  PHI_CHANNEL_RULE: "Patient details in Slack and screenshots",
  TEXT_ID_CHECK: "Checking who's texting",
  CANCEL_FOLLOWUP: "After a cancellation",
  LATE_CANCEL_RULE: "Late cancellations",
  CORRECTION_PROCESS: "Fixing a wrong-chart entry",
  EXCEPTION_OWNER: "Who approves exceptions",
  VOICEMAIL_RULE: "Voicemails",
  HOLD_TRANSFER_RULE: "Holds and transfers",
  COMPLAINT_RULE: "Complaints",
  AFTER_HOURS_RULE: "After-hours messages",
  OPT_OUT_RULE: "Text opt-outs",
  DOC_NAMING: "File naming",
  EOD_REPORT: "End-of-day report",
  URGENT_RULE: "Urgent scheduling requests",
  WAITLIST_RULE: "Waitlist",
  UNKNOWN_POLICY_RULE: "Questions about unwritten policies",
  CALL_NOTE_RULE: "Call notes",
  NONGUARANTEE_SCRIPT: "Coverage questions",
  DECLINE_RULE: "Declined cards",
  INS_ESCALATION: "Unclear insurance information",
};

// "LATE_CANCEL_RULE" -> "Late cancellations"; unknown keys are spelled out.
export function ruleName(key: string): string {
  if (RULE_NAMES[key]) return RULE_NAMES[key];
  const words = key
    .replace(/_(RULE|STEPS|SCRIPT)$/, "")
    .toLowerCase()
    .replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MAX_RULE = 140;

const oneLine = (s: string, n = MAX_RULE) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

// "No-show follow-up: call within 15 minutes".
export const ruleLine = (key: string, value: string) => `${ruleName(key)}: ${oneLine(value)}`;

// One item's source, from its scenario's source card and the rules filled into it.
export function describeRuleSource(input: {
  sourceCard: string | null;
  sourceQuote: string | null;
  topic: string; // the item's part title or workflow name
  rules: { key: string; value: string; source: string }[]; // the rules the grader used for this item
}): ItemRuleSource {
  const standards = input.rules.filter((r) => r.source === "vfda_default" && r.value.trim());
  const rules = [...new Set(standards.map((r) => ruleLine(r.key, r.value)))];
  if (!isVfdaSourceCard(input.sourceCard)) {
    return {
      kind: rules.length ? "vfda_standard" : "card",
      card: input.sourceCard!.trim(),
      rules,
    };
  }
  // No office card. The "VFDA standards" source quotes the standard itself;
  // otherwise name the topic.
  if (!rules.length) {
    const quote = input.sourceCard?.trim().toLowerCase() === "vfda standards" ? input.sourceQuote?.trim() : "";
    rules.push(
      quote ? `${oneLine(input.topic, 60)}: ${oneLine(quote)}` : `${oneLine(input.topic, 60)}: VFDA's standard steps (your office has no card for this)`,
    );
  }
  return { kind: "vfda_standard", card: null, rules };
}

// A stored value back into a source (null when it isn't one).
export function parseRuleSource(v: unknown): ItemRuleSource | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== "card" && o.kind !== "vfda_standard") return null;
  return {
    kind: o.kind,
    card: typeof o.card === "string" && o.card.trim() ? o.card : null,
    rules: Array.isArray(o.rules) ? o.rules.map(String).filter(Boolean) : [],
  };
}

// The notice's list: every VFDA standard rule in the report, once.
export function standardsUsed(sources: (ItemRuleSource | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (s?.kind !== "vfda_standard") continue;
    for (const r of s.rules) {
      const k = r.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
  }
  return out;
}

// A coaching tip's tag: "VFDA standard", or "Card: <name>".
export type TipTag = { kind: "vfda_standard" } | { kind: "card"; card: string };

export const tipTagOf = (s: ItemRuleSource | null | undefined, fallbackCard?: string | null): TipTag | null =>
  s?.kind === "vfda_standard"
    ? { kind: "vfda_standard" }
    : s?.card
      ? { kind: "card", card: s.card }
      : fallbackCard && !isVfdaSourceCard(fallbackCard)
        ? { kind: "card", card: fallbackCard }
        : null;

export const tipTagText = (t: TipTag) => (t.kind === "vfda_standard" ? "VFDA standard" : `Card: ${t.card}`);

// The notice's words, for the doctor/VFDA report and the VA's.
export const STANDARDS_NOTICE = {
  title: "Some answers were checked against VFDA standards",
  doctor: "Your office's cards didn't cover these, so VFDA's standard was used. Please discuss with your VA if these rules are correct for your office.",
  va: "Please discuss with your doctor if these rules are correct for your office.",
} as const;

// Tags for the VA's coaching tips. Each tip ends "Review: <card> ..." and
// covers the items of that card (src/lib/va-report.ts tipGroups); a tip is
// "VFDA standard" when any of those items relied on one.
export function vaTipTags(
  tips: string[],
  items: {
    sourceCard: string | null;
    workflowName: string;
    ruleSource?: ItemRuleSource | null;
  }[],
): (TipTag | null)[] {
  const cardOf = (i: (typeof items)[number]) => i.sourceCard?.trim() || `${i.workflowName} card`;
  const cards = [...new Set(items.map(cardOf))].sort((a, b) => b.length - a.length);
  return tips.map((t) => {
    const review = t.toLowerCase().lastIndexOf("review:");
    if (review < 0) return null;
    const after = t
      .slice(review + 7)
      .trim()
      .toLowerCase();
    const card = cards.find((c) => after.startsWith(c.toLowerCase()));
    if (!card) return null;
    const group = items.filter((i) => cardOf(i) === card);
    if (group.some((i) => i.ruleSource?.kind === "vfda_standard" || (!i.ruleSource && isVfdaSourceCard(i.sourceCard)))) return { kind: "vfda_standard" };
    return isVfdaSourceCard(card) ? null : { kind: "card", card };
  });
}

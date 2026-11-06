// Card-first setup, as pure functions: which training day(s) and workflow a
// card PDF feeds (suggested from its name and Trello color; VFDA can change
// it), how many gray card scenarios each gray card gets, and the 12 rules
// still asked of the doctor. No server-only imports, so tests can load it.

// The only rules the doctor is asked, and only when the cards don't cover them.
// FOLLOWUP_INTERVAL (insurance offices) and BILLING_AUTHORITY (billing
// offices) follow their slot's condition.
export const MUST_ASK_KEYS = [
  "CONFIRM_RULE",
  "NO_SHOW_RULE",
  "SAME_DAY_CUTOFF",
  "TEXT_RESPONSE_TIME",
  "CALLBACK_TIME",
  "ESCALATION_CHANNEL",
  "FOLLOWUP_INTERVAL",
  "VA_AUTHORITY",
  "BILLING_AUTHORITY",
  "PROHIBITED_PHRASES",
  "ESCALATION_CONTACT",
  "OFFICE_HOURS",
] as const;
const MUST_ASK = new Set<string>(MUST_ASK_KEYS);
export const isMustAsk = (key: string | null | undefined) => !!key && MUST_ASK.has(key);

// Questions written for a topic the office has no card for: the VFDA master
// bank and VFDA standards only.
export const NO_CARD_SOURCE = "VFDA standard – office has no card";

// Missing cards that matter most (gap report: high priority).
export const HIGH_PRIORITY_TOPICS: Record<string, string> = {
  "Texting & Phone Scripts": "phones",
  "New Patient Checklist": "new patients",
  Slack: "escalation",
  "VA Office Rules": "escalation and VA limits",
};

export const CARD_COLORS = ["green", "orange", "yellow", "gray", "other"] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export const GRAY_DAY = "W2D5";
// A gray card day with no master items to count: at most this many scenarios.
export const GRAY_ITEM_CAP = 20;

// Trello color → training week: green and orange cards are week 1, yellow
// week 2, gray the gray card day (extra phone scenarios).
export function weekOfColor(color: CardColor | null | undefined): 1 | 2 | null {
  if (color === "green" || color === "orange") return 1;
  if (color === "yellow" || color === "gray") return 2;
  return null;
}

// The upload checklist names (src/lib/doctor-flow.ts), with the day(s) each feeds
// when the card's own title doesn't say.
export const topicDays = (topic: string) => CHECKLIST_DAYS[topic] ?? [];
const CHECKLIST_DAYS: Record<string, string[]> = {
  "VA Onboarding": ["W1D1"],
  "Open & Close": ["W1D1"],
  "Patient Journey": ["W1D1"],
  "New Patient Checklist": ["W1D5"],
  "Re-exam": ["W1D5"],
  "Scheduling Cadence": ["W1D4"],
  "Texting & Phone Scripts": ["W1D3", "W2D1", "W2D2"],
  Slack: ["W2D1"],
  "Insurance & Billing": ["W2D3", "W2D4"],
  "Gray cards": [GRAY_DAY],
};

const STOP = new Set(["how", "to", "use", "the", "of", "with", "a", "an", "and", "card", "cards", "sop", "list", "flow", "checklist", "n", "daily"]);
export const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/re-?exam/g, "reexam")
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !STOP.has(t)),
  );

// True when the title and a day's card name share most of their words (e.g.
// "Phone Scripts" for "HOW TO: Phone Scripts/Phone Calls", but not "New
// Patient Checklist" for "Patient Journey").
export function nameMatches(dayCardName: string, title: string) {
  const want = tokens(dayCardName);
  const have = tokens(title);
  if (!want.size || !have.size) return false;
  const shared = [...want].filter((t) => have.has(t)).length;
  return shared / new Set([...want, ...have]).size >= 0.5;
}

export type DayForMapping = { code: string; cards: string[]; workflows: string[] };

export type CardForMapping = {
  title: string; // from the PDF
  cardName: string; // the upload checklist entry it was uploaded as
  color: CardColor | null;
  workflow: string | null; // what reading the card suggested
  // The standard day whose topic the card's content covers (reading it), if any.
  coversDay?: string | null;
};

// Suggested day(s) and workflow for one card, in this order: a gray (extra)
// card that actually covers a standard topic (by its title, or its content as
// read) goes to that topic's day, any other gray card to the gray card day
// (an extra card); then the days whose card names match the card's title (in
// the color's week when known); then the days of the checklist entry it was
// uploaded as; then the first day of the week covering the workflow.
export function suggestMapping(card: CardForMapping, days: DayForMapping[]): { days: string[]; workflow: string | null } {
  const week = weekOfColor(card.color);
  const inWeek = (code: string) => week === null || code.startsWith(`W${week}`);
  const known = new Set(days.map((d) => d.code));
  const pickWorkflow = (codes: string[]) =>
    card.workflow ?? days.find((d) => codes.includes(d.code))?.workflows[0] ?? null;

  if (card.color === "gray" || card.cardName === "Gray cards") {
    const named = card.title ? days.filter((d) => d.code !== GRAY_DAY && d.cards.some((c) => nameMatches(c, card.title))).map((d) => d.code) : [];
    if (named.length) return { days: named, workflow: pickWorkflow(named) };
    if (card.coversDay && card.coversDay !== GRAY_DAY && known.has(card.coversDay)) {
      return { days: [card.coversDay], workflow: pickWorkflow([card.coversDay]) };
    }
    return known.has(GRAY_DAY) ? { days: [GRAY_DAY], workflow: null } : { days: [], workflow: card.workflow };
  }
  if (card.title) {
    const byName = days.filter((d) => d.code !== GRAY_DAY && inWeek(d.code) && d.cards.some((c) => nameMatches(c, card.title))).map((d) => d.code);
    if (byName.length) return { days: byName, workflow: pickWorkflow(byName) };
  }
  const fromList = (CHECKLIST_DAYS[card.cardName] ?? []).filter((c) => known.has(c));
  const listInWeek = fromList.filter(inWeek);
  if (listInWeek.length || fromList.length) {
    const chosen = listInWeek.length ? listInWeek : fromList;
    return { days: chosen, workflow: pickWorkflow(chosen) };
  }
  if (card.workflow) {
    const day = days.find((d) => d.code !== GRAY_DAY && inWeek(d.code) && d.workflows.includes(card.workflow!));
    if (day) return { days: [day.code], workflow: card.workflow };
  }
  return { days: [], workflow: card.workflow };
}

// Gray card day: 1-2 scenarios per card up to `cap`. Patient-facing or risky
// cards get 2 and come first; when over the cap, other cards are dropped
// first (from the end), then priority cards go down to 1, then are dropped.
export const PRIORITY_TAGS = ["patient_facing", "risky"];
export function grayPlan<T extends { id: string; tags: string[] }>(cards: T[], cap: number): { card: T; count: number }[] {
  const priority = (c: T) => c.tags.some((t) => PRIORITY_TAGS.includes(t));
  const plan = [...cards.filter(priority), ...cards.filter((c) => !priority(c))].map((card) => ({
    card,
    count: priority(card) ? 2 : 1,
  }));
  const total = () => plan.reduce((n, p) => n + p.count, 0);
  while (plan.length && total() > cap) {
    const lastOther = plan.findLastIndex((p) => !priority(p.card));
    const lastDouble = plan.findLastIndex((p) => p.count === 2);
    if (lastOther >= 0) plan.splice(lastOther, 1);
    else if (lastDouble >= 0) plan[lastDouble].count = 1;
    else plan.pop();
  }
  return plan;
}

// Whitespace and quotes don't count when checking a quote against a card's text.
export const squashText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
export const quoteIn = (quote: string, text: string) => {
  const q = squashText(quote);
  return q.length > 0 && squashText(text).includes(q);
};

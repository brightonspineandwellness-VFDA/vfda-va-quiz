import "server-only";

// What Claude writes when building an office's scenarios. Card-first: a day's
// items are written from the office's own cards mapped to it, with the master
// day as the pattern; gray card items from the gray cards. Also multiple
// choice options from an options rule (days with no card), a skipped day's
// phone drills, and a repeat variant for each situational item. Every day
// keeps its day rules (src/lib/day-rules.ts: sources, item types, banned
// topics). Card-first items are checked one by one (forgiving source matching:
// src/lib/source-match.ts, then the day rules); a failing item is rewritten up
// to twice, then kept as "needs review" so the rest of the day still builds.
// Other answers are checked as a whole and retried once. VFDA reviews all of it.
// AI_MODE=mock writes stand-ins without calling Claude.

import { z } from "zod";
import { aiMode, askStructured } from "@/lib/ai";
import { checkDayItem, ITEM_TYPE_LABELS, ruleFor, rulesPrompt, typeOnDay, type DayRules, type ItemType } from "@/lib/day-rules";
import {
  BUTTON_WORDS,
  checkMc,
  hasPlaceholder,
  LETTERS,
  type CardItem,
  type CorrectResponse,
  type DraftScenario,
} from "@/lib/scenario-build";
import { matchCardName, resolveSource, STANDARDS_SOURCE } from "@/lib/source-match";
import { squashText } from "@/lib/card-map";

const SYSTEM = `You write training scenarios for virtual assistants (VAs) at one chiropractic office.
The office's own rules are given; use them exactly and never invent office policy.
Use fake patients only: made-up first names, no real people, no dates of birth, phone numbers, emails,
insurance or card numbers. Plain, short sentences; VAs may speak English as a second language.
Never leave {PLACEHOLDERS} in what you write.`;

const rulesBlock = (rules: { key: string; value: string }[]) =>
  rules.length ? rules.map((r) => `${r.key}: ${r.value}`).join("\n") : "(none)";

// Asks, checks, retries once with the problem named. Throws if both fail.
async function ask<S extends z.ZodType>(
  schema: S,
  text: string,
  check: (out: z.infer<S>) => string | null,
): Promise<z.infer<S>> {
  let problem: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await askStructured(schema, {
      system: SYSTEM,
      effort: "medium",
      maxTokens: 64000,
      content: [{ type: "text", text: problem ? `${text}\n\nYour last answer was rejected: ${problem}. Fix that.` : text }],
    });
    problem = check(out);
    if (!problem) return out;
  }
  throw new Error(`Claude's scenarios didn't pass the checks: ${problem}`);
}

const mock = () => aiMode() === "mock";
// Mock text: placeholders turned into neutral words, so checks still pass
// (not the key's own words: "escalation contact" would break a day's topics).
const unplaceholder = (s: string) => s.replace(/\{([A-Z0-9_]+)\}/g, "the office's rule");
const MOCK_OPTIONS = ["The office's way (right)", "Guess and move on", "Ask the patient to call back later", "Skip it"];

const McSchema = z.object({ code: z.string(), options: z.array(z.string()), answer: z.string().describe("A, B, C or D") });

// ---------------------------------------------------------------------------
// Card-first: one day's items written from the office's own cards.
// ---------------------------------------------------------------------------

export type CardSource = { id: string; title: string; text: string; workflow: string | null; tags?: string[] };
export type WorkflowFields = {
  code: string;
  name: string;
  trigger: string;
  steps: string[];
  definition_of_done: string;
  va_can_decide: string[];
  requires_approval: string[];
  immediate_escalation: string[];
  prohibited_actions: string[];
};

export { STANDARDS_SOURCE };

// One failed check on one item, for the System log.
export type CheckFailure = { item: string; field: string; value: string; reason: string };
export type LogFailure = (f: CheckFailure) => void;
// Rewrites of one item before it's saved for VFDA to review.
const ITEM_REWRITES = 2;

const BoxSteps = z.object({ box: z.string().nullable().describe("The box name (e.g. Say), or null for a plain step list"), steps: z.array(z.string()) });
const CardItemSchema = z.object({
  based_on: z.string().nullable().describe("The master item code this follows, or null for a new item"),
  type: z.enum(["mc", "situational", "describe"]),
  workflow: z.string().describe("Workflow code, e.g. WF04"),
  part_title: z.string(),
  stem: z.string(),
  options: z.array(z.string()).nullable(),
  answer: z.string().nullable().describe("A, B, C or D"),
  correct_response: z.array(BoxSteps).nullable().describe("Situational: the steps; describe: the key points (one list, box null)"),
  critical_fail: z.string().nullable(),
  escalation_level: z.enum(["none", "approval", "immediate"]),
  source_card: z.string().describe(`One of the allowed card names, exactly as listed, or "${STANDARDS_SOURCE}"`),
  source_quote: z.string().describe("The exact words from that card (or standard) the item is built on"),
});
type RawCardItem = z.infer<typeof CardItemSchema>;

const CARD_RULES = `Write from the office's own cards. They are the source; the master items only show the pattern (format,
answer format, the mix of multiple choice and situational items, difficulty).
- Every correct_response follows the card's own steps, in the card's order and wording where it can.
- source_card: one of the allowed card names below, exactly as written; source_quote: words copied exactly from
  that card's text (under 300 characters) that the item is built on.
- When a master item needs something the cards don't cover: use the VFDA standard for it if there is one
  (source_card "${STANDARDS_SOURCE}", quote the standard). If there's no standard either, drop that master
  item and write a different item from what the cards do cover. Never ask the doctor; never invent office policy.
- Every item keeps the day rules below: its allowed cards, item types and banned topics.
- Each item follows its own card's protocol; two cards may do things differently, and that's fine. But VFDA's
  safety standards always win, whatever a card says: RED_FLAGS, EMERGENCY_PROTOCOL, PATIENT_ID_CHECK and
  PHI_CHANNEL_RULE as listed in the standards below.
- Never write about exact buttons, menus or click paths. For the EHR, texting or phone system, the VA describes
  what they'd do in their own words; correct responses say what is done, not where to click.
- Multiple choice: 4 options (text only, no A-D letters), one right (the card's way), realistic decoys, right
  one at a random position.
- critical_fail only where something must never happen; escalation_level "immediate" for those, "approval" when
  the VA must get approval first, otherwise "none".
- Fake patients only: made-up first names; no real people, dates of birth, phone numbers, emails, insurance or card numbers.`;

// A day with no card: extra items are written from its master bank instead.
export const BANK_SOURCE = "Master bank";
const BANK_RULES = `Write from this day's master bank (the master items below) and the VFDA standards: new items on the same
skills and the same office rules, in new situations with new fake patients. Never copy a master item.
- source_card: "${BANK_SOURCE}"; source_quote: the code of the master item the new item is built on.
- Never write about exact buttons, menus or click paths; never invent office policy.
- Multiple choice: 4 options (text only, no A-D letters), one right, realistic decoys, right one at a random position.
- critical_fail only where something must never happen; escalation_level "immediate" for those, "approval" when
  the VA must get approval first, otherwise "none".
- Fake patients only: made-up first names; no real people, dates of birth, phone numbers, emails, insurance or card numbers.`;

const allowedNames = (cards: CardSource[]) =>
  `Allowed card names (source_card must be exactly one of these):\n${[...cards.map((c) => c.title), STANDARDS_SOURCE].map((n) => `- ${n}`).join("\n")}`;

const cardsBlock = (cards: CardSource[]) =>
  cards.map((c) => `## ${c.title}${c.workflow ? ` (${c.workflow})` : ""}\n${c.text}`).join("\n\n");

// What every card-first prompt carries: the cards, workflows, standards and day rules.
type ItemContext = {
  day: string;
  rules: DayRules;
  cards: CardSource[];
  standards: { key: string; value: string }[];
  boxes: string[] | null;
  // Gray card items: written answers (no multiple choice), plain step lists.
  gray: boolean;
  // No card: items come from the master bank (no source check against cards).
  bank?: boolean;
  sources: string;
  log: LogFailure;
};

const sourcesBlock = (
  cards: CardSource[],
  workflows: WorkflowFields[],
  standards: { key: string; value: string }[],
  day: string,
  rules: DayRules,
) => `<cards>
${cardsBlock(cards)}
</cards>
${workflows.length ? `\n<workflows>\n${JSON.stringify(workflows, null, 1)}\n</workflows>\n` : ""}
<vfda_standards>
${rulesBlock(standards)}
</vfda_standards>

${allowedNames(cards)}

<day_rules>
${rulesPrompt(day, rules, cards.map((c) => c.title))}
</day_rules>`;

function toCorrectResponse(raw: RawCardItem["correct_response"], boxes: string[] | null): CorrectResponse | null {
  if (!raw?.length) return null;
  if (!boxes) return raw.flatMap((b) => b.steps.map((s) => s.trim()).filter(Boolean));
  return Object.fromEntries(boxes.map((k) => [k, (raw.find((b) => b.box?.toLowerCase() === k.toLowerCase())?.steps ?? []).map((s) => s.trim()).filter(Boolean)]));
}

const shown = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v) ?? "").slice(0, 500);

// Everything but the source: one failure, or null. The day rules (item type,
// banned topics) are checked here too.
function checkContent(i: RawCardItem, ctx: ItemContext): Omit<CheckFailure, "item"> | null {
  if (ctx.gray && i.type === "mc") return { field: "type", value: i.type, reason: "gray card items are written answers, not multiple choice" };
  if (!i.stem.trim()) return { field: "stem", value: "", reason: "empty" };
  const broken = checkDayItem(i, ctx.day, ctx.rules);
  if (broken) return broken;
  if (i.type === "mc") {
    const bad = checkMc(i.options, i.answer);
    if (bad) return { field: "options", value: shown({ options: i.options, answer: i.answer }), reason: bad };
  } else if (i.type === "describe") {
    if (!i.correct_response?.some((b) => b.steps.some((s) => s.trim()))) {
      return { field: "correct_response", value: shown(i.correct_response), reason: "a describe item needs the key points a good answer covers" };
    }
  } else {
    if (!i.correct_response?.some((b) => b.steps.some((s) => s.trim()))) {
      return { field: "correct_response", value: shown(i.correct_response), reason: "a situational item needs steps" };
    }
    if (ctx.boxes) {
      const missing = ctx.boxes.filter((k) => !i.correct_response!.some((b) => b.box?.toLowerCase() === k.toLowerCase() && b.steps.length));
      if (missing.length) return { field: "correct_response", value: shown(i.correct_response), reason: `needs steps under ${missing.join(", ")}` };
    }
  }
  if (hasPlaceholder([i.stem, i.options, i.correct_response, i.critical_fail])) {
    return { field: "stem", value: shown(i.stem), reason: "a {PLACEHOLDER} is left" };
  }
  if (BUTTON_WORDS.test(JSON.stringify([i.stem, i.correct_response]))) {
    return { field: "stem", value: shown(i.stem), reason: "mentions buttons or clicking; describe it in the VA's own words" };
  }
  return null;
}

function toCardItem(i: RawCardItem, card: CardSource | null, boxes: string[] | null, reviewError: string | null = null): CardItem {
  return {
    based_on: i.based_on,
    type: i.type,
    workflow: i.workflow.trim() || card?.workflow || "WF04",
    part_title: i.part_title.trim(),
    stem: i.stem.trim(),
    // The app shows its own A-D letters.
    options: i.type === "mc" ? (i.options ?? []).map((o) => o.trim().replace(/^[A-D][).:]\s+/, "")) : null,
    answer: i.type === "mc" ? (i.answer ?? "").trim().toUpperCase() : null,
    // Describe: the key points as one list.
    correct_response: i.type === "mc" ? null : toCorrectResponse(i.correct_response, i.type === "describe" ? null : boxes),
    critical_fail: i.type === "describe" ? null : i.critical_fail?.trim() || null,
    escalation_level: i.type === "describe" ? "none" : i.escalation_level,
    source_card: i.source_card,
    source_quote: i.source_quote.trim().slice(0, 1000),
    source_document_id: card?.id ?? null,
    review_error: reviewError,
  };
}

// Checks one item: the content, then the source (forgiving). A passing item
// carries the card it came from and the passage found as its quote.
function checkCardItem(i: RawCardItem, ctx: ItemContext): { item: CardItem } | { failure: Omit<CheckFailure, "item"> } {
  const bad = checkContent(i, ctx);
  if (bad) return { failure: bad };
  if (ctx.bank) return { item: toCardItem({ ...i, source_card: BANK_SOURCE, source_quote: i.source_quote.trim().slice(0, 200) }, null, ctx.boxes) };
  const src = resolveSource(i.source_card, i.source_quote, ctx.cards, ctx.standards);
  if (!src.ok) return { failure: { field: src.field, value: shown(src.value), reason: src.reason } };
  return { item: toCardItem({ ...i, source_card: src.source_card, source_quote: src.source_quote }, src.card, ctx.boxes) };
}

const itemLabel = (n: number, i: { based_on: string | null; type: string }) => `item ${n + 1}${i.based_on ? ` (${i.based_on})` : ""} ${i.type}`;

const boxesText = (type: ItemType, ctx: ItemContext) =>
  type === "describe"
    ? "; correct_response is the key points (one list, box null)"
    : type === "mc"
      ? ""
      : ctx.gray || !ctx.boxes
        ? "; correct_response as a plain list of steps (box null)"
        : `; correct_response split into ${ctx.boxes.join(", ")}`;

// The type a rewrite must have: a type the day doesn't allow becomes one it
// does (situational -> describe); gray card items are never multiple choice.
function rewriteType(type: ItemType, ctx: ItemContext): ItemType {
  const rule = ruleFor(ctx.rules, ctx.day);
  const t = typeOnDay(type, rule);
  return ctx.gray && t === "mc" ? typeOnDay("situational", rule) : t;
}

// Asks Claude to rewrite one item, saying exactly what was wrong.
async function rewriteItem(raw: RawCardItem, failure: Omit<CheckFailure, "item">, ctx: ItemContext): Promise<RawCardItem> {
  const type = rewriteType(raw.type, ctx);
  const out = await askStructured(z.object({ item: CardItemSchema }), {
    system: SYSTEM,
    effort: "medium",
    maxTokens: 16000,
    content: [
      {
        type: "text",
        text: `${ctx.bank ? BANK_RULES : CARD_RULES}

${ctx.sources}

Rewrite ONLY the item below so it passes the check. ${type === raw.type ? "Keep its type" : "Make it type"} "${type}" (${ITEM_TYPE_LABELS[type]})${
          raw.based_on ? `, based_on ${raw.based_on}` : ""
        }${boxesText(type, ctx)}.
What was wrong: ${failure.field}${failure.value ? ` ${JSON.stringify(failure.value)}` : ""}: ${failure.reason}.

<item>
${JSON.stringify(raw, null, 1)}
</item>`,
      },
    ],
  });
  return out.item;
}

// One item: checked; on a failure rewritten (up to ITEM_REWRITES times) with
// the problem named; still failing, kept with the error for VFDA to review.
// `failure` starts the rewrites at once (VFDA's Regenerate). Every failed
// check is logged.
async function settleItem(raw: RawCardItem, label: string, ctx: ItemContext, failure?: Omit<CheckFailure, "item">): Promise<CardItem> {
  let current = raw;
  let problem: Omit<CheckFailure, "item"> | null = failure ?? null;
  for (let tries = 0; ; tries++) {
    if (!problem) {
      const r = checkCardItem(current, ctx);
      if ("item" in r) return r.item;
      problem = r.failure;
      ctx.log({ item: label, ...problem });
    }
    if (tries >= ITEM_REWRITES) break;
    try {
      current = await rewriteItem(current, problem, ctx);
    } catch (e) {
      problem = { field: "item", value: "", reason: `rewrite failed: ${e instanceof Error ? e.message : String(e)}` };
      ctx.log({ item: label, ...problem });
      break;
    }
    problem = null;
  }
  const named = matchCardName(current.source_card, ctx.cards);
  return toCardItem(current, named?.kind === "card" ? named.card : null, ctx.boxes, `${problem.field}: ${problem.reason}`);
}

// Asks for a whole set of items; a wrong count is asked again once, then the
// items are used as they are (logged).
async function askItems(text: string, countProblem: (items: RawCardItem[]) => string | null, log: LogFailure) {
  const schema = z.object({ items: z.array(CardItemSchema) });
  let problem: string | null = null;
  let items: RawCardItem[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await askStructured(schema, {
      system: SYSTEM,
      effort: "medium",
      maxTokens: 64000,
      content: [{ type: "text", text: problem ? `${text}\n\nYour last answer was rejected: ${problem}. Fix that.` : text }],
    });
    items = out.items;
    problem = countProblem(items);
    if (!problem) break;
    log({ item: "day", field: "items", value: `${items.length} items`, reason: problem });
  }
  if (!items.length) throw new Error("Claude wrote no items for this day.");
  return items;
}

const countText = (counts: Record<ItemType, number>) =>
  (Object.keys(ITEM_TYPE_LABELS) as ItemType[])
    .filter((t) => counts[t])
    .map((t) => `${counts[t]} ${ITEM_TYPE_LABELS[t]}`)
    .join(", ");

const typeCounts = (items: { type: ItemType }[]) => ({
  mc: items.filter((i) => i.type === "mc").length,
  situational: items.filter((i) => i.type === "situational").length,
  describe: items.filter((i) => i.type === "describe").length,
});

// A day: as many items, of the same types, as its own master items (`slots`,
// already in the day's types), following the master items it may use
// (`pool`: its own that keep the day rules, plus any moved in from other
// days); slots the pool doesn't cover are new items from the day's cards.
// With `existing`, only the items still missing are written (`slots` are the
// missing ones), different from those; with no cards they come from the
// day's master bank.
export async function writeCardDay(input: {
  day: { code: string; title: string; answer_format: string };
  slots: DraftScenario[];
  pool: DraftScenario[];
  cards: CardSource[];
  workflows: WorkflowFields[];
  standards: { key: string; value: string }[];
  boxes: string[] | null;
  rules: DayRules;
  existing?: string[];
  log?: LogFailure;
}): Promise<CardItem[]> {
  const want = typeCounts(input.slots);
  const total = input.slots.length;
  const bank = !input.cards.length;
  if (mock()) return mockCardDay(input);
  const log = input.log ?? (() => {});
  const sources = bank
    ? `${input.workflows.length ? `<workflows>\n${JSON.stringify(input.workflows, null, 1)}\n</workflows>\n\n` : ""}<vfda_standards>
${rulesBlock(input.standards)}
</vfda_standards>

<day_rules>
${rulesPrompt(input.day.code, input.rules, [])}
</day_rules>`
    : sourcesBlock(input.cards, input.workflows, input.standards, input.day.code, input.rules);
  const ctx: ItemContext = { day: input.day.code, rules: input.rules, cards: input.cards, standards: input.standards, boxes: input.boxes, gray: false, bank, sources, log };

  const text = `${
    input.existing
      ? `Training day ${input.day.code} "${input.day.title}" at this office has ${input.existing.length} items (below) and needs ${total} more: write exactly ${total} new items, different from those:`
      : `Write the test for training day ${input.day.code} "${input.day.title}" at this office: exactly ${total} items:`
  }
${countText(want)}.
${
  bank
    ? "Build each on one of the master items below (based_on null), from this day's master bank."
    : `Follow the master items below where they fit (based_on = their code); write every other item new (based_on null)
from this day's own cards.`
}
${want.situational ? (input.boxes ? `Situational correct responses are split into the boxes ${input.boxes.join(", ")} (each with steps).` : "Situational correct responses are a plain list of steps (box null).") : ""}

${bank ? BANK_RULES : CARD_RULES}
${input.existing ? `\n<items_already_in_the_day>\n${input.existing.map((s) => `- ${s}`).join("\n")}\n</items_already_in_the_day>\n` : ""}
<master_items>
${
  input.pool
    .map(
      (m) =>
        `## ${m.code} (${m.type}, ${m.points} pt, ${m.workflow}, ${m.part_title})\n${m.stem}` +
        (m.type === "mc"
          ? m.options
            ? `\nOptions: ${m.options.map((o, k) => `${LETTERS[k]}) ${o}`).join(" | ")}\nAnswer: ${m.answer}`
            : `\nOptions rule: ${m.options_rule ?? ""}`
          : m.type === "describe"
            ? `\nKey points: ${JSON.stringify(m.correct_response)}`
            : `\nCorrect response: ${JSON.stringify(m.correct_response)}${m.critical_fail ? `\nCritical fail: ${m.critical_fail}` : ""}`),
    )
    .join("\n\n") || "(none: write every item new from the cards)"
}
</master_items>

${sources}`;
  const items = await askItems(
    text,
    (items) => {
      if (items.length !== total) return `need exactly ${total} items, got ${items.length}`;
      const got = typeCounts(items);
      const off = (Object.keys(want) as ItemType[]).filter((t) => got[t] !== want[t]);
      return off.length ? `need exactly ${countText(want)}; got ${countText(got) || "none"}` : null;
    },
    log,
  );
  return Promise.all(items.map((i, n) => settleItem(i, itemLabel(n, i), ctx)));
}

// VFDA's "Regenerate" on an item that needs review: rewritten from the same
// cards (up to ITEM_REWRITES times), told what was wrong.
export async function regenerateCardItem(input: {
  day: string;
  item: Omit<RawCardItem, "based_on"> & { based_on?: string | null; code: string };
  problem: string;
  cards: CardSource[];
  workflows: WorkflowFields[];
  standards: { key: string; value: string }[];
  boxes: string[] | null;
  gray: boolean;
  rules: DayRules;
  log?: LogFailure;
}): Promise<CardItem> {
  const log = input.log ?? (() => {});
  const ctx: ItemContext = {
    day: input.day,
    rules: input.rules,
    cards: input.cards,
    standards: input.standards,
    boxes: input.boxes,
    gray: input.gray,
    sources: sourcesBlock(input.cards, input.workflows, input.standards, input.day, input.rules),
    log,
  };
  const raw: RawCardItem = { ...input.item, based_on: input.item.based_on ?? null };
  if (mock()) {
    const card = input.cards[0];
    return card ? mockItem(card, rewriteType(raw.type, ctx), `${card.title}: ${raw.stem}`, null) : toCardItem(raw, null, input.boxes, input.problem);
  }
  const [field, ...rest] = input.problem.split(": ");
  return settleItem(raw, input.item.code, ctx, { field: rest.length ? field : "item", value: "", reason: rest.length ? rest.join(": ") : input.problem });
}

function mockItem(card: CardSource, type: ItemType, stem: string, basedOn: DraftScenario | null): CardItem {
  const quote = card.text.split(/\n/).find((l) => l.trim())?.trim().slice(0, 120) ?? card.title;
  const cr = basedOn?.correct_response;
  return {
    based_on: basedOn?.code ?? null,
    type,
    workflow: basedOn?.workflow ?? card.workflow ?? "WF04",
    part_title: basedOn?.part_title ?? card.title,
    stem: unplaceholder(stem),
    options: type === "mc" ? (basedOn?.options ?? MOCK_OPTIONS).map(unplaceholder) : null,
    answer: type === "mc" ? (basedOn?.options ? (basedOn.answer ?? "A") : "A") : null,
    correct_response:
      type === "mc"
        ? null
        : type === "describe"
          ? cr && Array.isArray(cr)
            ? cr.map(unplaceholder)
            : [`explains "${card.title}" in their own words`, "names why it matters to patients"]
          : cr
            ? (JSON.parse(unplaceholder(JSON.stringify(cr))) as CorrectResponse)
            : [`follows "${card.title}" step by step`, "documents what was done"],
    critical_fail: type !== "describe" && basedOn?.critical_fail ? unplaceholder(basedOn.critical_fail) : null,
    escalation_level: type === "describe" ? "none" : ((basedOn?.escalation_level as CardItem["escalation_level"]) ?? "none"),
    source_card: card.title,
    source_quote: quote,
    source_document_id: card.id,
    review_error: null,
  };
}

// Mock: the pool's items first, in the slots' types; new items for the rest
// (extra items: only new ones, from the master bank when there's no card).
function mockCardDay(input: { slots: DraftScenario[]; pool: DraftScenario[]; cards: CardSource[]; existing?: string[]; day: { code: string } }): CardItem[] {
  const bank: CardSource = { id: "", title: BANK_SOURCE, text: input.pool[0]?.code ?? input.day.code, workflow: null };
  const free = input.existing ? [] : [...input.pool];
  return input.slots.map((slot, n) => {
    const card = input.cards.length ? input.cards[n % input.cards.length] : bank;
    if (input.existing) {
      const item = mockItem(card, slot.type, `${input.day.code}: extra question ${n + 1} (${card.title})`, null);
      return card === bank ? { ...item, source_document_id: null } : item;
    }
    const k = free.findIndex((m) => m.type === slot.type);
    if (k < 0) return mockItem(card, slot.type, `${card.title}: question ${n + 1}`, null);
    const m = free.splice(k, 1)[0];
    return mockItem(card, m.type, m.stem, m);
  });
}

// ---------------------------------------------------------------------------
// Multiple choice options built from a rule (options_rule).
// ---------------------------------------------------------------------------

export async function buildOptions(items: DraftScenario[], rules: { key: string; value: string }[]) {
  if (!items.length) return new Map<string, { options: string[]; answer: string }>();
  if (mock()) return new Map(items.map((i) => [i.code, { options: [unplaceholder(i.answer ?? MOCK_OPTIONS[0]), ...MOCK_OPTIONS.slice(1)], answer: "A" }]));
  const schema = z.object({ items: z.array(McSchema) });
  const text = `Build the four answer options for each multiple choice question below, following its options rule.
Exactly one option is right (the "answer" description); the decoys must be clearly wrong for THIS office
but realistic. Put the right option in a random position and give its letter.

<office_rules>
${rulesBlock(rules)}
</office_rules>

<questions>
${items.map((i) => `## ${i.code}\nQuestion: ${i.stem}\nOptions rule: ${i.options_rule}\nRight answer: ${i.answer}`).join("\n\n")}
</questions>`;
  const out = await ask(schema, text, (o) => {
    for (const i of items) {
      const got = o.items.find((x) => x.code === i.code);
      if (!got) return `missing ${i.code}`;
      const bad = checkMc(got.options, got.answer) ?? (hasPlaceholder(got.options) ? "placeholder left" : null);
      if (bad) return `${i.code}: ${bad}`;
    }
    return null;
  });
  return new Map(out.items.map((i) => [i.code, { options: i.options.map((o) => o.trim()), answer: i.answer.trim().toUpperCase() }]));
}

// ---------------------------------------------------------------------------
// W2D5: items from the office's gray cards (settings.gray_formulas etc.).
// ---------------------------------------------------------------------------

export type GrayCard = { id: string; code: string; risk_tag: string | null; answers: Record<string, unknown> };

const GrayItem = z.object({
  card: z.string().describe("The card's code, e.g. WF-G1"),
  formula: z.string().describe("The formula code, e.g. S-1 or MC-2"),
  type: z.enum(["mc", "situational"]),
  stem: z.string(),
  options: z.array(z.string()).nullable(),
  answer: z.string().nullable(),
  correct_response: z.array(z.string()).nullable(),
  critical_fail: z.string().nullable(),
});
export type GrayItem = z.infer<typeof GrayItem>;

export async function writeGrayItems(input: {
  cards: GrayCard[];
  formulas: unknown;
  split: unknown;
  fillRule: string;
  rules: { key: string; value: string }[];
}) {
  if (mock()) {
    return input.cards.map((c) => ({
      card: c.code,
      formula: "S-1",
      type: "situational" as const,
      stem: `(mock) A task from ${String(c.answers.CARD_NAME ?? c.code)} comes in.`,
      options: null,
      answer: null,
      correct_response: ["follows the card's steps", "documents what was done"],
      critical_fail: null,
    }));
  }
  const schema = z.object({ items: z.array(GrayItem) });
  const codes = new Set(input.cards.map((c) => c.code));
  const text = `Write the gray card day: test items built from this office's own extra workflows (gray cards).

Use the formulas (stems with {CARD_NAME} etc. filled from the card's answers). For situational items, the
correct_response is the list of steps a good answer has ("look_for" fields, plus look_for_base where given);
critical_fail is set only where the formula has critical_from. Multiple choice items have 4 options with
the right one at a random position and its letter as answer; decoys follow the formula's decoys if given.

How many items per card, and which formulas are required, follow the split by risk tag ("items" is
[version A, version B] situational counts: write only the version A count; "mc" is multiple choice
items per card).
Fill rule: ${input.fillRule}

<formulas>
${JSON.stringify(input.formulas, null, 1)}
</formulas>

<split>
${JSON.stringify(input.split, null, 1)}
</split>

<cards>
${input.cards.map((c) => `## ${c.code} (${c.risk_tag ?? "occasional"})\n${JSON.stringify(c.answers, null, 1)}`).join("\n\n")}
</cards>

<office_rules>
${rulesBlock(input.rules)}
</office_rules>`;
  const out = await ask(schema, text, (o) => {
    if (!o.items.length) return "no items";
    for (const [n, i] of o.items.entries()) {
      if (!codes.has(i.card)) return `item ${n + 1}: unknown card ${i.card}`;
      if (!i.stem.trim()) return `item ${n + 1}: empty stem`;
      if (i.type === "mc") {
        const bad = checkMc(i.options, i.answer);
        if (bad) return `item ${n + 1}: ${bad}`;
      } else if (!i.correct_response?.length) return `item ${n + 1}: situational item needs correct_response`;
      if (hasPlaceholder([i.stem, i.options, i.correct_response, i.critical_fail])) return `item ${n + 1}: placeholder left`;
    }
    return null;
  });
  return out.items;
}

// ---------------------------------------------------------------------------
// A skipped day: 20 extra phone drills (settings.skipped_day_rule).
// ---------------------------------------------------------------------------

const Drill = z.object({
  stem: z.string(),
  say: z.array(z.string()),
  do: z.array(z.string()),
  book: z.array(z.string()),
  critical_fail: z.string().nullable(),
});
export type Drill = z.infer<typeof Drill>;

export async function writePhoneDrills(input: {
  count: number;
  rule: string;
  dayTitle: string;
  rules: { key: string; value: string }[];
}) {
  if (mock()) {
    return Array.from({ length: input.count }, (_, n) => ({
      stem: `(mock) Phone call ${n + 1}: a patient calls to reschedule.`,
      say: ["greets with the office script"],
      do: ["finds the appointment and notes the call"],
      book: ["offers the next open slot"],
      critical_fail: null,
    }));
  }
  const schema = z.object({ items: z.array(Drill) });
  const text = `This office skips the training day "${input.dayTitle}". Instead: ${input.rule}
Write exactly ${input.count} different phone call scenarios a VA at this office handles: new patients,
existing patients, reschedules, cancellations, questions the VA must not answer, urgent symptoms.
For each, the steps a good answer has, split into Say (what the VA says), Do (what the VA does in the
EHR, texting or phone system) and Book (what gets booked). Book may say "nothing to book" when right.
Set critical_fail only where something must never happen (e.g. giving a diagnosis, ignoring red flags).

<office_rules>
${rulesBlock(input.rules)}
</office_rules>`;
  const out = await ask(schema, text, (o) => {
    if (o.items.length !== input.count) return `need exactly ${input.count} scenarios, got ${o.items.length}`;
    for (const [n, i] of o.items.entries()) {
      if (!i.stem.trim() || !i.say.length || !i.do.length || !i.book.length) return `scenario ${n + 1} is incomplete`;
      if (hasPlaceholder(i)) return `scenario ${n + 1}: placeholder left`;
    }
    return null;
  });
  return out.items;
}

// ---------------------------------------------------------------------------
// Repeat variants: shown right after a situational answer below 2/2.
// ---------------------------------------------------------------------------

const Variant = z.object({
  code: z.string(),
  repeat_stem: z.string().nullable(),
});
export type Variant = z.infer<typeof Variant>;

// Items whose repeat still doesn't come back after one more ask go without a
// repeat (logged); the day is never failed for a repeat.
export async function writeVariants(items: DraftScenario[], rules: { key: string; value: string }[], log?: LogFailure) {
  const wanted = items.filter((i) => i.wants_repeat);
  if (!wanted.length) return new Map<string, Variant>();
  if (mock()) return new Map(wanted.map((i) => [i.code, { code: i.code, repeat_stem: `(Repeat) ${i.stem}` }]));
  const schema = z.object({ items: z.array(Variant) });
  const found = new Map<string, Variant>();
  let todo = wanted;
  for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
    const text = `For each test item below, write repeat_stem: a repeat variant shown right after a missed answer.
Same skill and correct response, new details (different fake patient, time, situation). Keep each item's code.

<office_rules>
${rulesBlock(rules)}
</office_rules>

<items>
${todo
  .map(
    (i) =>
      `## ${i.code}\nStem: ${i.stem}\nCorrect response: ${JSON.stringify(i.correct_response)}${i.critical_fail ? `\nCritical fail: ${i.critical_fail}` : ""}`,
  )
  .join("\n\n")}
</items>`;
    let out: { items: Variant[] } = { items: [] };
    try {
      out = await askStructured(schema, { system: SYSTEM, effort: "medium", maxTokens: 64000, content: [{ type: "text", text }] });
    } catch (e) {
      log?.({ item: "repeats", field: "repeat_stem", value: "", reason: `Claude error: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    for (const v of out.items) {
      const stem = v.repeat_stem?.trim();
      if (todo.some((i) => i.code === v.code) && stem && !hasPlaceholder(stem) && !found.has(v.code)) found.set(v.code, { code: v.code, repeat_stem: stem });
    }
    todo = todo.filter((i) => !found.has(i.code));
  }
  for (const i of todo) log?.({ item: i.code, field: "repeat_stem", value: "", reason: "no usable repeat variant after asking twice; saved without one" });
  return found;
}

// ---------------------------------------------------------------------------
// Recheck variants: new details for scenarios the VA was certified on.
// ---------------------------------------------------------------------------

export async function writeRecheckVariants(
  items: { key: string; stem: string; correct_response: unknown; critical_fail: string | null }[],
  rules: { key: string; value: string }[],
) {
  if (mock()) return new Map(items.map((i) => [i.key, `(Recheck) ${i.stem}`]));
  const schema = z.object({ items: z.array(z.object({ key: z.string(), stem: z.string() })) });
  const text = `A VA certified on this workflow months ago is being rechecked. For each item below, write a new
stem: the same skill, the same correct response, new details (different fake patient, time and
situation), different from the original. Fake patients only.

<office_rules>
${rulesBlock(rules)}
</office_rules>

<items>
${items
  .map(
    (i) =>
      `## ${i.key}\nStem: ${i.stem}\nCorrect response: ${JSON.stringify(i.correct_response)}${i.critical_fail ? `\nCritical fail: ${i.critical_fail}` : ""}`,
  )
  .join("\n\n")}
</items>`;
  const out = await ask(schema, text, (o) => {
    for (const i of items) {
      const v = o.items.find((x) => x.key === i.key);
      if (!v?.stem.trim()) return `missing ${i.key}`;
      if (v.stem.trim() === i.stem.trim()) return `${i.key}: same as the original`;
      if (hasPlaceholder(v.stem)) return `${i.key}: placeholder left`;
    }
    return null;
  });
  return new Map(out.items.map((v) => [v.key, v.stem.trim()]));
}

// ---------------------------------------------------------------------------
// Retake variants: a whole day again, every item with new details. Situational
// items also get the repeat shown right after a missed answer.
// ---------------------------------------------------------------------------

export type RetakeItem = {
  key: string;
  type: "mc" | "situational" | "describe";
  stem: string;
  options: string[] | null;
  answer: string | null;
  correct_response: unknown;
  critical_fail: string | null;
  // Versions the VA has seen (the item and its repeat): the new ones must differ.
  seen: string[];
  wantsRepeat: boolean;
};
export type RetakeVariant = { stem: string; repeat_stem: string | null };

export async function writeRetakeVariants(items: RetakeItem[], rules: { key: string; value: string }[]) {
  if (mock()) {
    return new Map<string, RetakeVariant>(
      items.map((i) => [i.key, { stem: `(Retake) ${i.stem}`, repeat_stem: i.wantsRepeat ? `(Retake repeat) ${i.stem}` : null }]),
    );
  }
  const schema = z.object({ items: z.array(z.object({ key: z.string(), stem: z.string(), repeat_stem: z.string().nullable() })) });
  const text = `A VA is retaking a whole training day. For each item below, write a new stem: the same skill and the same
correct answer, new details (different fake patient, time and situation), different from every version under "Seen".
Multiple choice items keep their options exactly as listed, so write the stem so the same option is still the right
answer. For items marked "Repeat: yes", also write repeat_stem: one more version with other new details, shown right
after a missed answer; otherwise repeat_stem is null. Keep each item's key.

<office_rules>
${rulesBlock(rules)}
</office_rules>

<items>
${items
  .map((i) =>
    [
      `## ${i.key} (${i.type === "mc" ? "multiple choice" : i.type})`,
      `Stem: ${i.stem}`,
      i.options ? `Options: ${i.options.map((o, n) => `${LETTERS[n] ?? n + 1}) ${o}`).join(" | ")}\nRight answer: ${i.answer ?? ""}` : "",
      i.type !== "mc" ? `Correct response: ${JSON.stringify(i.correct_response)}` : "",
      i.critical_fail ? `Critical fail: ${i.critical_fail}` : "",
      `Seen:\n${i.seen.map((s) => `- ${s}`).join("\n")}`,
      `Repeat: ${i.wantsRepeat ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  )
  .join("\n\n")}
</items>`;
  const squash = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const out = await ask(schema, text, (o) => {
    for (const i of items) {
      const v = o.items.find((x) => x.key === i.key);
      const stem = v?.stem.trim() ?? "";
      if (!stem) return `missing ${i.key}`;
      if (i.seen.some((s) => squash(s) === squash(stem))) return `${i.key}: same as a version the VA has seen`;
      if (hasPlaceholder(stem)) return `${i.key}: placeholder left`;
      if (i.wantsRepeat) {
        const repeat = v?.repeat_stem?.trim() ?? "";
        if (!repeat) return `${i.key}: repeat_stem missing`;
        if (squash(repeat) === squash(stem) || i.seen.some((s) => squash(s) === squash(repeat))) return `${i.key}: repeat_stem not new`;
        if (hasPlaceholder(repeat)) return `${i.key}: placeholder left in repeat_stem`;
      }
    }
    return null;
  });
  return new Map<string, RetakeVariant>(
    out.items.map((v) => [v.key, { stem: v.stem.trim(), repeat_stem: items.find((i) => i.key === v.key)?.wantsRepeat ? (v.repeat_stem?.trim() ?? null) : null }]),
  );
}

// ---------------------------------------------------------------------------
// Extra cards (src/lib/extra-workflow.ts): the items planned from the office's
// approved extra workflows. A process card's situational item gets a realistic
// trigger and fake patient (its answer key is the card's steps, set by the
// builder); multiple choice and info questions are written from the card.
// Every item quotes the card.
// ---------------------------------------------------------------------------

export type ExtraItemRequest = {
  key: string;
  type: "situational" | "mc" | "info";
  card: { title: string; text: string };
  workflow: { name: string; trigger: string; steps: string[]; requires_approval: string[]; immediate_escalation: string[]; definition_of_done: string };
  fallbackQuote: string;
};
export type ExtraItem = {
  type: ItemType;
  stem: string;
  options: string[] | null;
  answer: string | null;
  key_points: string[] | null;
  source_quote: string;
};

const ExtraSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      type: z.enum(["situational", "mc", "describe"]),
      stem: z.string(),
      options: z.array(z.string()).nullable(),
      answer: z.string().nullable().describe("A, B, C or D for multiple choice"),
      key_points: z.array(z.string()).nullable().describe("For describe: the key points a good answer covers, from the card"),
      source_quote: z.string().describe("The card's exact words the item is based on (copied, under 300 characters)"),
    }),
  ),
});

export async function writeExtraItems(input: { day: string; items: ExtraItemRequest[]; rules: DayRules }): Promise<Map<string, ExtraItem>> {
  if (!input.items.length) return new Map();
  if (mock()) {
    return new Map<string, ExtraItem>(
      input.items.map((i): [string, ExtraItem] => {
        const base = { source_quote: i.fallbackQuote, options: null, answer: null, key_points: null };
        if (i.type === "situational") {
          return [i.key, { ...base, type: "situational" as const, stem: `Sam (a fake patient) needs help: ${i.workflow.trigger || i.workflow.name}. What do you do?` }];
        }
        if (i.type === "mc") return [i.key, { ...base, type: "mc" as const, stem: `${i.card.title}: what does the office do?`, options: MOCK_OPTIONS, answer: "A" }];
        const points = i.card.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
        return [i.key, { ...base, type: "describe" as const, stem: `In your own words, what does "${i.card.title}" tell you?`, key_points: points.length ? points : [i.card.title] }];
      }),
    );
  }
  const text = `Write one training item per request below, for training day ${input.day}, from this office's own extra cards.
- situational: a task scenario with a realistic trigger (what just happened) and a made-up patient, ending with what the VA
  does now. The VA answers in boxes: Steps / Say / Document-Escalate. Don't give away the steps. options, answer and
  key_points are null.
- mc: one multiple choice question about the card's process: 4 options, exactly one right per the card, answer the letter.
- info: either "mc" (as above) or "describe" (a short question answered in the VA's own words, with key_points from the
  card) about the card's information, whichever fits it better.
Every item quotes the card's exact words in source_quote. Keep each key.

${rulesPrompt(input.day, input.rules, input.items.map((i) => i.card.title))}

${input.items
  .map(
    (i) =>
      `## ${i.key} (${i.type}) from "${i.card.title}"
Workflow: ${i.workflow.name}${i.workflow.trigger ? `. Starts when: ${i.workflow.trigger}` : ""}
${i.workflow.steps.length ? `Steps: ${i.workflow.steps.join(" | ")}` : ""}
${i.workflow.requires_approval.length ? `Needs approval: ${i.workflow.requires_approval.join("; ")}` : ""}
${i.workflow.immediate_escalation.length ? `Escalate at once: ${i.workflow.immediate_escalation.join("; ")}` : ""}
<card_text>
${i.card.text.slice(0, 6000)}
</card_text>`,
  )
  .join("\n\n")}`;
  const out = await ask(ExtraSchema, text, (o) => {
    for (const i of input.items) {
      const v = o.items.find((x) => x.key === i.key);
      if (!v || !v.stem.trim()) return `missing ${i.key}`;
      if (hasPlaceholder(v.stem)) return `${i.key}: placeholder left`;
      const want = i.type === "info" ? ["mc", "describe"] : [i.type];
      if (!want.includes(v.type)) return `${i.key}: must be ${want.join(" or ")}`;
      if (v.type === "mc") {
        const problem = checkMc(v.options, v.answer);
        if (problem) return `${i.key}: ${problem}`;
      }
      if (v.type === "describe" && !v.key_points?.some((p) => p.trim())) return `${i.key}: key_points missing`;
    }
    return null;
  });
  return new Map(
    input.items.map((i) => {
      const v = out.items.find((x) => x.key === i.key)!;
      const quote = v.source_quote.trim();
      return [
        i.key,
        {
          type: v.type,
          stem: v.stem.trim(),
          options: v.type === "mc" ? (v.options ?? []).map((o) => o.trim()) : null,
          answer: v.type === "mc" ? (v.answer ?? "").trim().toUpperCase() : null,
          key_points: v.type === "describe" ? (v.key_points ?? []).map((p) => p.trim()).filter(Boolean) : null,
          // A quote that isn't on the card: the workflow's own quote instead.
          source_quote: quote && squashText(i.card.text).includes(squashText(quote)) ? quote.slice(0, 300) : i.fallbackQuote,
        },
      ];
    }),
  );
}

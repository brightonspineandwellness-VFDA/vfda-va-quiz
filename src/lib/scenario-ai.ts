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
- Never write about exact buttons, menus or click paths. For the EHR, texting or phone system, the VA describes
  what they'd do in their own words; correct responses say what is done, not where to click.
- Multiple choice: 4 options (text only, no A-D letters), one right (the card's way), realistic decoys, right
  one at a random position.
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
        text: `${CARD_RULES}

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
export async function writeCardDay(input: {
  day: { code: string; title: string; answer_format: string };
  slots: DraftScenario[];
  pool: DraftScenario[];
  cards: CardSource[];
  workflows: WorkflowFields[];
  standards: { key: string; value: string }[];
  boxes: string[] | null;
  rules: DayRules;
  log?: LogFailure;
}): Promise<CardItem[]> {
  const want = typeCounts(input.slots);
  const total = input.slots.length;
  if (mock()) return mockCardDay(input);
  const log = input.log ?? (() => {});
  const sources = sourcesBlock(input.cards, input.workflows, input.standards, input.day.code, input.rules);
  const ctx: ItemContext = { day: input.day.code, rules: input.rules, cards: input.cards, standards: input.standards, boxes: input.boxes, gray: false, sources, log };

  const text = `Write the test for training day ${input.day.code} "${input.day.title}" at this office: exactly ${total} items:
${countText(want)}.
Follow the master items below where they fit (based_on = their code); write every other item new (based_on null)
from this day's own cards.
${want.situational ? (input.boxes ? `Situational correct responses are split into the boxes ${input.boxes.join(", ")} (each with steps).` : "Situational correct responses are a plain list of steps (box null).") : ""}

${CARD_RULES}

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

// Gray card day: `count` written items per card (1-2, planned by grayPlan):
// situational where the day allows it, otherwise describe.
export async function writeCardGrayItems(input: {
  day: string;
  cards: (CardSource & { count: number })[];
  standards: { key: string; value: string }[];
  rules: DayRules;
  log?: LogFailure;
}): Promise<CardItem[]> {
  const total = input.cards.reduce((n, c) => n + c.count, 0);
  const log = input.log ?? (() => {});
  const sources = sourcesBlock(input.cards, [], input.standards, input.day, input.rules);
  const ctx: ItemContext = { day: input.day, rules: input.rules, cards: input.cards, standards: input.standards, boxes: null, gray: true, sources, log };
  const type = rewriteType("situational", ctx);
  if (mock()) {
    return input.cards.flatMap((c) =>
      Array.from({ length: c.count }, (_, k) => mockItem(c, type, `${c.title}: what do you do here? (${k + 1})`, null)),
    );
  }
  const text = `Write the gray card day: ${type === "situational" ? "task scenarios" : "short questions the VA answers in their own words"} from this office's extra cards.
Exactly the number of items listed per card (${total} in all), each with based_on null, type "${type}" and
correct_response as a plain list of ${type === "describe" ? "key points" : "steps"} (box null). The cards are the source.
Items per card: ${input.cards.map((c) => `"${c.title}": ${c.count}${c.tags?.length ? ` (${c.tags.join(", ")})` : ""}`).join("; ")}.

${CARD_RULES}

${sources}`;
  const items = await askItems(
    text,
    (items) => {
      for (const c of input.cards) {
        const got = items.filter((i) => {
          const named = matchCardName(i.source_card, input.cards);
          return named?.kind === "card" && named.card === c;
        }).length;
        if (got !== c.count) return `"${c.title}" needs exactly ${c.count} item(s), got ${got}`;
      }
      return null;
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

// Mock: the pool's items first, in the slots' types; new items for the rest.
function mockCardDay(input: { slots: DraftScenario[]; pool: DraftScenario[]; cards: CardSource[] }): CardItem[] {
  const free = [...input.pool];
  return input.slots.map((slot, n) => {
    const card = input.cards[n % input.cards.length];
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

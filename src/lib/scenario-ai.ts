import "server-only";

// What Claude writes when building an office's scenarios. Card-first: a day's
// items are written from the office's own cards mapped to it, with the master
// day as the pattern; gray card items from the gray cards. Also multiple
// choice options from an options rule (days with no card), a skipped day's
// phone drills, and a repeat variant for each situational item. Each
// answer is checked (src/lib/scenario-build.ts) and retried once; VFDA reviews
// all of it. AI_MODE=mock writes stand-ins without calling Claude.

import { z } from "zod";
import { aiMode, askStructured } from "@/lib/ai";
import { quoteIn } from "@/lib/card-map";
import {
  BUTTON_WORDS,
  checkMc,
  hasPlaceholder,
  LETTERS,
  type CardItem,
  type CorrectResponse,
  type DraftScenario,
} from "@/lib/scenario-build";

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
// Mock text: placeholders turned into plain words, so checks still pass.
const unplaceholder = (s: string) => s.replace(/\{([A-Z0-9_]+)\}/g, (_, k: string) => k.toLowerCase().replace(/_/g, " "));
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

export const STANDARDS_SOURCE = "VFDA standards";

const BoxSteps = z.object({ box: z.string().nullable().describe("The box name (e.g. Say), or null for a plain step list"), steps: z.array(z.string()) });
const CardItemSchema = z.object({
  based_on: z.string().nullable().describe("The master item code this follows, or null for a new item"),
  type: z.enum(["mc", "situational"]),
  workflow: z.string().describe("Workflow code, e.g. WF04"),
  part_title: z.string(),
  stem: z.string(),
  options: z.array(z.string()).nullable(),
  answer: z.string().nullable().describe("A, B, C or D"),
  correct_response: z.array(BoxSteps).nullable(),
  critical_fail: z.string().nullable(),
  escalation_level: z.enum(["none", "approval", "immediate"]),
  source_card: z.string().describe(`The card's title exactly as listed, or "${STANDARDS_SOURCE}"`),
  source_quote: z.string().describe("The exact words from that card (or standard) the item is built on"),
});
type RawCardItem = z.infer<typeof CardItemSchema>;

const CARD_RULES = `Write from the office's own cards. They are the source; the master items only show the pattern (format,
answer format, the mix of multiple choice and situational items, difficulty).
- Every correct_response follows the card's own steps, in the card's order and wording where it can.
- source_card: the card's title exactly as listed; source_quote: words copied exactly from that card's text
  (under 300 characters) that the item is built on.
- When a master item needs something the cards don't cover: use the VFDA standard for it if there is one
  (source_card "${STANDARDS_SOURCE}", quote the standard). If there's no standard either, drop that master
  item and write a different item from what the cards do cover. Never ask the doctor; never invent office policy.
- Never write about exact buttons, menus or click paths. For the EHR, texting or phone system, the VA describes
  what they'd do in their own words; correct responses say what is done, not where to click.
- Multiple choice: 4 options (text only, no A-D letters), one right (the card's way), realistic decoys, right
  one at a random position.
- critical_fail only where something must never happen; escalation_level "immediate" for those, "approval" when
  the VA must get approval first, otherwise "none".
- Fake patients only: made-up first names; no real people, dates of birth, phone numbers, emails, insurance or card numbers.`;

const cardsBlock = (cards: CardSource[]) =>
  cards.map((c) => `## ${c.title}${c.workflow ? ` (${c.workflow})` : ""}\n${c.text}`).join("\n\n");

function toCorrectResponse(raw: RawCardItem["correct_response"], boxes: string[] | null): CorrectResponse | null {
  if (!raw?.length) return null;
  if (!boxes) return raw.flatMap((b) => b.steps.map((s) => s.trim()).filter(Boolean));
  return Object.fromEntries(boxes.map((k) => [k, (raw.find((b) => b.box?.toLowerCase() === k.toLowerCase())?.steps ?? []).map((s) => s.trim()).filter(Boolean)]));
}

// Checks one item; null when it's fine.
function checkCardItem(i: RawCardItem, cards: CardSource[], standards: { key: string; value: string }[], boxes: string[] | null) {
  if (!i.stem.trim()) return "empty stem";
  if (i.type === "mc") {
    const bad = checkMc(i.options, i.answer);
    if (bad) return bad;
  } else {
    if (!i.correct_response?.some((b) => b.steps.some((s) => s.trim()))) return "situational item needs correct_response";
    if (boxes) {
      const missing = boxes.filter((k) => !i.correct_response!.some((b) => b.box?.toLowerCase() === k.toLowerCase() && b.steps.length));
      if (missing.length) return `correct_response needs steps under ${missing.join(", ")}`;
    }
  }
  if (hasPlaceholder([i.stem, i.options, i.correct_response, i.critical_fail])) return "placeholder left";
  if (BUTTON_WORDS.test(JSON.stringify([i.stem, i.correct_response]))) return "mentions buttons or clicking; describe it in the VA's own words";
  if (!i.source_quote.trim()) return "missing source_quote";
  if (i.source_card === STANDARDS_SOURCE) {
    if (!standards.some((s) => quoteIn(i.source_quote, s.value))) return "source_quote isn't the words of a VFDA standard";
  } else {
    const card = cards.find((c) => c.title === i.source_card);
    if (!card) return `unknown source_card "${i.source_card}"`;
    if (!quoteIn(i.source_quote, card.text)) return `source_quote isn't copied from "${card.title}"`;
  }
  return null;
}

function toCardItem(i: RawCardItem, cards: CardSource[], boxes: string[] | null): CardItem {
  const card = cards.find((c) => c.title === i.source_card);
  return {
    based_on: i.based_on,
    type: i.type,
    workflow: i.workflow.trim() || card?.workflow || "WF04",
    part_title: i.part_title.trim(),
    stem: i.stem.trim(),
    // The app shows its own A-D letters.
    options: i.type === "mc" ? (i.options ?? []).map((o) => o.trim().replace(/^[A-D][).:]\s+/, "")) : null,
    answer: i.type === "mc" ? (i.answer ?? "").trim().toUpperCase() : null,
    correct_response: i.type === "situational" ? toCorrectResponse(i.correct_response, boxes) : null,
    critical_fail: i.critical_fail?.trim() || null,
    escalation_level: i.escalation_level,
    source_card: i.source_card,
    source_quote: i.source_quote.trim().slice(0, 1000),
    source_document_id: card?.id ?? null,
  };
}

export async function writeCardDay(input: {
  day: { code: string; title: string; answer_format: string };
  masters: DraftScenario[];
  cards: CardSource[];
  workflows: WorkflowFields[];
  standards: { key: string; value: string }[];
  boxes: string[] | null;
}): Promise<CardItem[]> {
  const mcCount = input.masters.filter((m) => m.type === "mc").length;
  const total = input.masters.length;
  if (mock()) return mockCardDay(input);

  const schema = z.object({ items: z.array(CardItemSchema) });
  const text = `Write the test for training day ${input.day.code} "${input.day.title}" at this office: exactly ${total} items,
${mcCount} multiple choice and ${total - mcCount} situational, like the master day below.
${input.boxes ? `Situational correct responses are split into the boxes ${input.boxes.join(", ")} (each with steps).` : "Situational correct responses are a plain list of steps (box null)."}

${CARD_RULES}

<cards>
${cardsBlock(input.cards)}
</cards>

<master_day>
${input.masters
  .map(
    (m) =>
      `## ${m.code} (${m.type}, ${m.points} pt, ${m.workflow}, ${m.part_title})\n${m.stem}` +
      (m.type === "mc"
        ? m.options
          ? `\nOptions: ${m.options.map((o, k) => `${LETTERS[k]}) ${o}`).join(" | ")}\nAnswer: ${m.answer}`
          : `\nOptions rule: ${m.options_rule ?? ""}`
        : `\nCorrect response: ${JSON.stringify(m.correct_response)}${m.critical_fail ? `\nCritical fail: ${m.critical_fail}` : ""}`),
  )
  .join("\n\n")}
</master_day>

<workflows>
${JSON.stringify(input.workflows, null, 1)}
</workflows>

<vfda_standards>
${rulesBlock(input.standards)}
</vfda_standards>`;
  const out = await ask(schema, text, (o) => {
    if (o.items.length !== total) return `need exactly ${total} items, got ${o.items.length}`;
    const mc = o.items.filter((i) => i.type === "mc").length;
    if (mc !== mcCount) return `need exactly ${mcCount} multiple choice items, got ${mc}`;
    for (const [n, i] of o.items.entries()) {
      const bad = checkCardItem(i, input.cards, input.standards, input.boxes);
      if (bad) return `item ${n + 1}: ${bad}`;
    }
    return null;
  });
  return out.items.map((i) => toCardItem(i, input.cards, input.boxes));
}

// Gray card day: `count` situational items per card (1-2, planned by grayPlan).
export async function writeCardGrayItems(input: {
  cards: (CardSource & { count: number })[];
  standards: { key: string; value: string }[];
}): Promise<CardItem[]> {
  const total = input.cards.reduce((n, c) => n + c.count, 0);
  if (mock()) {
    return input.cards.flatMap((c) =>
      Array.from({ length: c.count }, (_, k) => mockItem(c, "situational", `${c.title}: a patient asks about this (${k + 1})`, null)),
    );
  }
  const schema = z.object({ items: z.array(CardItemSchema) });
  const text = `Write the gray card day: situational phone and task scenarios from this office's extra cards.
Exactly the number of items listed per card (${total} in all), each with based_on null, type "situational" and
correct_response as a plain list of steps (box null). The cards are the source.

${CARD_RULES}

<cards>
${input.cards.map((c) => `## ${c.title} (${c.count} item${c.count > 1 ? "s" : ""}${c.tags?.length ? `; ${c.tags.join(", ")}` : ""})\n${c.text}`).join("\n\n")}
</cards>

<vfda_standards>
${rulesBlock(input.standards)}
</vfda_standards>`;
  const out = await ask(schema, text, (o) => {
    for (const c of input.cards) {
      const got = o.items.filter((i) => i.source_card === c.title).length;
      if (got !== c.count) return `"${c.title}" needs exactly ${c.count} item(s), got ${got}`;
    }
    for (const [n, i] of o.items.entries()) {
      if (i.type !== "situational") return `item ${n + 1}: gray card items are situational`;
      const bad = checkCardItem(i, input.cards, input.standards, null);
      if (bad) return `item ${n + 1}: ${bad}`;
    }
    return null;
  });
  return out.items.map((i) => toCardItem(i, input.cards, null));
}

function mockItem(card: CardSource, type: "mc" | "situational", stem: string, basedOn: DraftScenario | null): CardItem {
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
        : cr
          ? (JSON.parse(unplaceholder(JSON.stringify(cr))) as CorrectResponse)
          : [`follows "${card.title}" step by step`, "documents what was done"],
    critical_fail: basedOn?.critical_fail ? unplaceholder(basedOn.critical_fail) : null,
    escalation_level: (basedOn?.escalation_level as CardItem["escalation_level"]) ?? "none",
    source_card: card.title,
    source_quote: quote,
    source_document_id: card.id,
  };
}

function mockCardDay(input: { masters: DraftScenario[]; cards: CardSource[] }): CardItem[] {
  return input.masters.map((m, n) => mockItem(input.cards[n % input.cards.length], m.type, m.stem, m));
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

export async function writeVariants(items: DraftScenario[], rules: { key: string; value: string }[]) {
  const wanted = items.filter((i) => i.wants_repeat);
  if (!wanted.length) return new Map<string, Variant>();
  if (mock()) return new Map(wanted.map((i) => [i.code, { code: i.code, repeat_stem: `(Repeat) ${i.stem}` }]));
  const schema = z.object({ items: z.array(Variant) });
  const text = `For each test item below, write repeat_stem: a repeat variant shown right after a missed answer.
Same skill and correct response, new details (different fake patient, time, situation).

<office_rules>
${rulesBlock(rules)}
</office_rules>

<items>
${wanted
  .map(
    (i) =>
      `## ${i.code}\nStem: ${i.stem}\nCorrect response: ${JSON.stringify(i.correct_response)}${i.critical_fail ? `\nCritical fail: ${i.critical_fail}` : ""}`,
  )
  .join("\n\n")}
</items>`;
  const out = await ask(schema, text, (o) => {
    for (const i of wanted) {
      const v = o.items.find((x) => x.code === i.code);
      if (!v) return `missing ${i.code}`;
      if (!v.repeat_stem?.trim()) return `${i.code}: needs repeat_stem`;
      if (hasPlaceholder(v)) return `${i.code}: placeholder left`;
    }
    return null;
  });
  return new Map(out.items.map((v) => [v.code, v]));
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

import "server-only";

// What Claude writes when building an office's scenarios: multiple choice
// options from an options rule, W2D5 gray card items, a skipped day's phone
// drills, and for every item its version B and repeat variant. Each answer is
// checked (src/lib/scenario-build.ts) and retried once; VFDA reviews all of it.

import { z } from "zod";
import { askStructured } from "@/lib/ai";
import { checkMc, hasPlaceholder, LETTERS, type DraftScenario } from "@/lib/scenario-build";

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

const McSchema = z.object({ code: z.string(), options: z.array(z.string()), answer: z.string().describe("A, B, C or D") });

// ---------------------------------------------------------------------------
// Multiple choice options built from a rule (options_rule).
// ---------------------------------------------------------------------------

export async function buildOptions(items: DraftScenario[], rules: { key: string; value: string }[]) {
  if (!items.length) return new Map<string, { options: string[]; answer: string }>();
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
  version: z.enum(["A", "B"]),
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
  const schema = z.object({ items: z.array(GrayItem) });
  const codes = new Set(input.cards.map((c) => c.code));
  const text = `Write the gray card day: test items built from this office's own extra workflows (gray cards).

Use the formulas (stems with {CARD_NAME} etc. filled from the card's answers). For situational items, the
correct_response is the list of steps a good answer has ("look_for" fields, plus look_for_base where given);
critical_fail is set only where the formula has critical_from. Multiple choice items have 4 options with
the right one at a random position and its letter as answer; decoys follow the formula's decoys if given.

How many items per card, and which formulas are required, follow the split by risk tag ("items" is
[version A, version B] situational counts; "mc" is multiple choice items per card per version).
Fill rule: ${input.fillRule}
Write version A and version B (different details, same skills).

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
    if (!o.items.some((i) => i.version === "A") || !o.items.some((i) => i.version === "B")) return "need version A and B items";
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
// Version B and repeat variants for a day's items.
// ---------------------------------------------------------------------------

const Variant = z.object({
  code: z.string(),
  b_stem: z.string().nullable(),
  b_options: z.array(z.string()).nullable(),
  b_answer: z.string().nullable(),
  repeat_stem: z.string().nullable(),
  b_repeat_stem: z.string().nullable(),
});
export type Variant = z.infer<typeof Variant>;

// With versionB false (gray items, which come with their own version B),
// only the repeat variants are written.
export async function writeVariants(items: DraftScenario[], rules: { key: string; value: string }[], versionB = true) {
  const wanted = versionB ? items : items.filter((i) => i.wants_repeat);
  if (!wanted.length) return new Map<string, Variant>();
  const schema = z.object({ items: z.array(Variant) });
  const asks = versionB
    ? `- b_stem: version B, used when a VA retakes the day. Same skill, same right answer and correct response,
  new details (different fake patient, time, situation). For multiple choice also b_options (4) and
  b_answer (letter of the right one, at a random position).
- repeat_stem (situational items marked "repeat"): a repeat variant shown right after a missed answer.
  Same correct response, new details, different from version A and B.
- b_repeat_stem (same items): a repeat variant of version B.
Leave b_options/b_answer null for situational items, and the repeat stems null where not asked.`
    : `- repeat_stem: a repeat variant shown right after a missed answer. Same correct response, new details.
Leave b_stem, b_options, b_answer and b_repeat_stem null.`;
  const text = `For each test item below, write:
${asks}

<office_rules>
${rulesBlock(rules)}
</office_rules>

<items>
${wanted
  .map(
    (i) =>
      `## ${i.code} (${i.type}${i.wants_repeat ? ", repeat" : ""})\nStem: ${i.stem}\n` +
      (i.type === "mc"
        ? `Options: ${(i.options ?? []).map((o, k) => `${LETTERS[k]}) ${o}`).join(" | ")}\nAnswer: ${i.answer}`
        : `Correct response: ${JSON.stringify(i.correct_response)}${i.critical_fail ? `\nCritical fail: ${i.critical_fail}` : ""}`),
  )
  .join("\n\n")}
</items>`;
  const out = await ask(schema, text, (o) => {
    for (const i of wanted) {
      const v = o.items.find((x) => x.code === i.code);
      if (!v) return `missing ${i.code}`;
      if (i.wants_repeat && !v.repeat_stem?.trim()) return `${i.code}: needs repeat_stem`;
      if (!versionB) continue;
      if (!v.b_stem?.trim()) return `${i.code}: empty b_stem`;
      if (i.type === "mc") {
        const bad = checkMc(v.b_options, v.b_answer);
        if (bad) return `${i.code}: ${bad}`;
      }
      if (i.wants_repeat && !v.b_repeat_stem?.trim()) return `${i.code}: needs b_repeat_stem`;
      if (hasPlaceholder(v)) return `${i.code}: placeholder left`;
    }
    return null;
  });
  return new Map(out.items.map((v) => [v.code, v]));
}

// The pure half of reading a card PDF: what the model is asked, the shape it
// must answer in, and the checks that turn its answer into the card's mapping
// and office rules. No server-only imports, so tests can load it.

import { z } from "zod";
import { CARD_COLORS, tokens, type CardColor } from "@/lib/card-map";
import { checkAnswerValue, type AnswerValue, type InterviewQuestion } from "@/lib/interview";

export const CardReadSchema = z.object({
  card: z.object({
    title: z.string().describe("The card's title as written on it"),
    color: z.enum([...CARD_COLORS, "unknown"]).describe("The card's Trello label or cover color"),
    has_process_content: z
      .boolean()
      .describe("false when the card has no steps, rules or scripts (only links, attachments, or nothing)"),
    text: z.string().describe("Everything the card says, word for word: title, description, checklists, comments"),
    workflow: z.string().nullable().describe("The workflow code it fits best, e.g. WF04, or null"),
    covers_day: z
      .string()
      .nullable()
      .describe("The standard training day (code from the list) whose topic this card covers, whatever its name; null if it covers none"),
    patient_facing: z.boolean().describe("true when the VA talks or writes to patients in this task"),
    risky: z.boolean().describe("true when mistakes cost money, leak patient information, or touch legal or clinical matters"),
  }),
  rules: z.array(
    z.object({
      key: z.string().describe("The rule slot key, exactly as listed"),
      partial: z.boolean().describe("true if the card only partly answers the slot"),
      value: z.string().describe("The rule in plain words; for list slots, one item per line"),
      quote: z.string().describe("The exact words from the card that support the rule"),
    }),
  ),
});
export type CardReadOutput = z.infer<typeof CardReadSchema>;

export const SYSTEM = `You read one Trello card from a chiropractic office (exported as a PDF). The card is part of how the
office trains its virtual assistant (VA).

1. Describe the card:
- title: the card's title.
- color: the card's Trello label or cover color (green, orange, yellow, gray), "other" for another color, "unknown" if none shows.
- text: everything the card says, copied word for word (description, checklists, scripts, comments). Leave out
  link URLs and attachment file names. Keep the card's own line breaks and numbering.
- has_process_content: false when the card has no steps, rules or scripts: only links, attachments, or nothing.
- workflow: the workflow code it fits best, or null.
- covers_day: the standard training day (from the list) whose topic the card actually covers, judged by its content, not
  its name (e.g. a card named "Front desk calls" covers the phone day); null when it covers none of them (an extra card
  about something else, like a referral process or a supply order).
- patient_facing / risky: as described in the schema.

2. Rule slots: for each slot listed, report a rule only when the card actually states it:
- value: the office's rule in plain, short words, keeping the office's own specifics (times, names, channels, amounts).
  For list slots, put one item per line.
- quote: the exact words from the card that support it (copy them; keep it under 300 characters).
- partial: true when the card covers only part of what the slot asks.
Leave a slot out entirely when the card doesn't cover it. Never invent rules or fill gaps with general best practice.

The cards should contain no real patient information. If you notice any, don't copy it into the text, a value or a quote.`;

type SlotForExtraction = Pick<InterviewQuestion, "key" | "question" | "answer_type">;
export type DocumentForExtraction = { id: string; file_name: string; card_name: string; file_path: string };
export type Workflow = { code: string; name: string };

const FORMAT_HINT: Partial<Record<InterviewQuestion["answer_type"], string>> = {
  list: "list",
  yesno: "yes or no",
  upload: "text (scripts or templates: copy the wording)",
};

// The VA Office Rules card (src/lib/doctor-flow.ts OFFICE_RULES_CARD) is a
// form: each office rule's question, then the doctor's "Our answer:".
export const OFFICE_RULES_PROMPT = `This card is the office's VA Office Rules card: a form where the doctor answered each office rule
after "Our answer:". For each rule slot listed, report what the doctor wrote after "Our answer:" for that question:
- value: the answer, in the doctor's own words (for list slots, one item per line).
- quote: the "Our answer:" line(s), copied.
- partial: false.
If the answer says to use the VFDA default (e.g. "VFDA default"), put exactly VFDA default as the value.
Leave a slot out when its "Our answer:" is blank or the card doesn't ask it.`;

// A standard training day and the topic its cards cover.
export type DayTopic = { code: string; title: string; cards: string[] };

export function buildPrompt(
  slots: SlotForExtraction[],
  document: DocumentForExtraction,
  workflows: Workflow[],
  officeRulesCard = false,
  days: DayTopic[] = [],
) {
  const slotList = slots.map((s) => `- ${s.key} [${FORMAT_HINT[s.answer_type] ?? "text"}]: ${s.question}`).join("\n");
  const workflowList = workflows.map((w) => `- ${w.code}: ${w.name}`).join("\n");
  const dayList = days.map((d) => `- ${d.code}: ${d.title}${d.cards.length ? ` (cards: ${d.cards.join(", ")})` : ""}`).join("\n");
  return `The card: ${document.card_name || "Card"} (${document.file_name})\n\nWorkflows:\n${workflowList}\n\nStandard training days:\n${dayList || "(none)"}\n\nRule slots:\n${slotList || "(none)"}${
    officeRulesCard ? `\n\n${OFFICE_RULES_PROMPT}` : ""
  }`;
}

// Turns the model's text value into the slot's answer shape.
export function toAnswerValue(slot: Pick<InterviewQuestion, "answer_type">, text: string): AnswerValue {
  const value = text.trim();
  switch (slot.answer_type) {
    case "list":
      return value
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter(Boolean);
    case "yesno":
      return /^y(es)?\b/i.test(value) ? "yes" : /^no?\b/i.test(value) ? "no" : null;
    case "upload":
      return { text: value, links: [] };
    case "matrix":
      return null;
    default:
      return value;
  }
}

export type CardReading = {
  card_title: string;
  card_color: CardColor | null;
  extracted_text: string;
  skip: boolean;
  workflow: string | null;
  tags: string[];
};

// Checks the model's answer against the slots and workflows it was given.
// Anything that doesn't fit is dropped. coversDay: a standard day from
// `dayCodes` whose topic the card covers (null: none).
export function toReading(output: CardReadOutput, slots: InterviewQuestion[], document: DocumentForExtraction, workflows: Workflow[], dayCodes: string[] = []) {
  const c = output.card;
  const text = c.text.trim();
  const reading: CardReading = {
    card_title: (c.title.trim() || document.card_name || document.file_name.replace(/\.pdf$/i, "")).slice(0, 300),
    card_color: c.color === "unknown" ? null : c.color,
    extracted_text: text.slice(0, 100_000),
    skip: !c.has_process_content || !text,
    workflow: c.workflow && workflows.some((w) => w.code === c.workflow) ? c.workflow : null,
    tags: [c.patient_facing && "patient_facing", c.risky && "risky"].filter((t): t is string => !!t),
  };
  const slotByKey = new Map(slots.map((s) => [s.key, s]));
  const rules = new Map<string, { rule_slot_key: string; source_document_id: string; rule: AnswerValue; source_quote: string; partial: boolean }>();
  for (const r of output.rules) {
    const slot = slotByKey.get(r.key);
    if (!slot || !r.value.trim()) continue;
    const rule = toAnswerValue(slot, r.value);
    if (rule === null || (Array.isArray(rule) && rule.length === 0) || checkAnswerValue(slot, rule) !== null) continue;
    // One proposal per slot and document (the table allows no more).
    rules.set(slot.key, {
      rule_slot_key: slot.key,
      source_document_id: document.id,
      rule,
      source_quote: r.quote.trim().slice(0, 1000),
      partial: r.partial,
    });
  }
  const coversDay = c.covers_day && dayCodes.includes(c.covers_day) ? c.covers_day : null;
  return { reading, rules: [...rules.values()], coversDay };
}

// ---------------------------------------------------------------------------
// The VA Office Rules card: "Our answer:" for each must-ask rule.
// ---------------------------------------------------------------------------

export const isVfdaDefault = (text: string) =>
  /^\W*(?:use\s+(?:the\s+)?)?(?:vfda(?:'s|’s)?\s+)?(?:default|standard|suggestion)\W*$/i.test(text.trim());

type FoundAnswer = { key: string; value: string; quote: string };
const ANSWER_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?our answer(?:\*\*)?\s*[:：]\s*(.*)$/i;

// Reads the card's own text: each "Our answer:" belongs to the question just
// above it, matched to a slot by its key (when the card shows it) or by the
// words it shares with the slot's question. An empty "Our answer:" line takes
// the lines below it, up to a blank line. Used for the slots the model's
// reading missed.
export function parseOfficeRulesCard(text: string, slots: Pick<InterviewQuestion, "key" | "question">[]): FoundAnswer[] {
  const lines = text.split(/\r?\n/);
  const found = new Map<string, FoundAnswer>();
  let contextStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = ANSWER_LINE.exec(lines[i]);
    if (!m) continue;
    const context = lines
      .slice(contextStart, i)
      .filter((l) => l.trim())
      .slice(-3)
      .join(" ");
    const answer = [m[1].trim()];
    let end = i + 1;
    if (!answer[0]) {
      while (end < lines.length && lines[end].trim() && !ANSWER_LINE.test(lines[end])) answer.push(lines[end++].trim());
    }
    contextStart = end;
    const value = answer.filter(Boolean).join("\n").trim();
    const slot = matchSlot(context, slots);
    if (!slot || !value || found.has(slot.key)) continue;
    found.set(slot.key, { key: slot.key, value, quote: lines.slice(i, end).join("\n").trim().slice(0, 1000) });
  }
  return [...found.values()];
}

function matchSlot<S extends Pick<InterviewQuestion, "key" | "question">>(context: string, slots: S[]): S | null {
  const byKey = slots.find((s) => new RegExp(`\b${s.key}\b`).test(context));
  if (byKey) return byKey;
  const have = tokens(context);
  const scored = slots
    .map((s) => {
      const want = tokens(s.question);
      const shared = [...want].filter((t) => have.has(t)).length;
      return { s, score: want.size ? shared / want.size : 0 };
    })
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < 0.5 || (next && next.score === best.score)) return null;
  return best.s;
}

// The doctor's answers on the VA Office Rules card, as office rules: the
// model's reading first, then the card's text for slots it missed. "VFDA
// default" is the slot's suggested answer, taken as the doctor's own; a slot
// with no suggestion stays blank (asked in step 4).
export function toOfficeRules(
  fromModel: FoundAnswer[],
  text: string,
  slots: InterviewQuestion[],
  document: DocumentForExtraction,
) {
  const slotByKey = new Map(slots.map((s) => [s.key, s]));
  const rules = new Map<string, { rule_slot_key: string; source_document_id: string; rule: AnswerValue; source_quote: string; partial: boolean }>();
  for (const r of [...fromModel, ...parseOfficeRulesCard(text, slots)]) {
    const slot = slotByKey.get(r.key);
    if (!slot || rules.has(slot.key) || !r.value.trim()) continue;
    const rule = isVfdaDefault(r.value) ? slot.suggested_answer : toAnswerValue(slot, r.value);
    if (rule === null || (Array.isArray(rule) && rule.length === 0) || checkAnswerValue(slot, rule) !== null) continue;
    rules.set(slot.key, {
      rule_slot_key: slot.key,
      source_document_id: document.id,
      rule,
      source_quote: r.quote.trim().slice(0, 1000),
      partial: false,
    });
  }
  return [...rules.values()];
}

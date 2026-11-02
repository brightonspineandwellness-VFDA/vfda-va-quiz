// The pure half of reading a card PDF: what the model is asked, the shape it
// must answer in, and the checks that turn its answer into the card's mapping
// and office rules. No server-only imports, so tests can load it.

import { z } from "zod";
import { CARD_COLORS, type CardColor } from "@/lib/card-map";
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

export function buildPrompt(slots: SlotForExtraction[], document: DocumentForExtraction, workflows: Workflow[]) {
  const slotList = slots.map((s) => `- ${s.key} [${FORMAT_HINT[s.answer_type] ?? "text"}]: ${s.question}`).join("\n");
  const workflowList = workflows.map((w) => `- ${w.code}: ${w.name}`).join("\n");
  return `The card: ${document.card_name || "Card"} (${document.file_name})\n\nWorkflows:\n${workflowList}\n\nRule slots:\n${slotList || "(none)"}`;
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
// Anything that doesn't fit is dropped.
export function toReading(output: CardReadOutput, slots: InterviewQuestion[], document: DocumentForExtraction, workflows: Workflow[]) {
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
  return { reading, rules: [...rules.values()] };
}

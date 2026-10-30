// The pure half of rule extraction: what the model is asked, the shape it
// must answer in, and the checks that turn its answer into office rules.
// No server-only imports, so tests can load it.

import { z } from "zod";
import { checkAnswerValue, type AnswerValue, type InterviewQuestion } from "@/lib/interview";

export const ExtractionSchema = z.object({
  rules: z.array(
    z.object({
      key: z.string().describe("The rule slot key, exactly as listed"),
      document: z.number().describe("The document number the rule came from"),
      partial: z.boolean().describe("true if the card only partly answers the slot"),
      value: z.string().describe("The rule in plain words; for list slots, one item per line"),
      quote: z.string().describe("The exact words from the card that support the rule"),
    }),
  ),
  edge_cases: z.array(
    z.object({
      workflow: z.string().describe("Workflow code, e.g. WF04"),
      question: z.string().describe("One short question for the doctor"),
    }),
  ),
});
export type ExtractionOutput = z.infer<typeof ExtractionSchema>;

export const SYSTEM = `You read a chiropractic office's Trello cards (exported as PDFs) and pull out the office rules a virtual assistant (VA) needs.

For each rule slot listed, look for what the cards say. Report a rule only when the cards actually state it:
- value: the office's rule in plain, short words, keeping the office's own specifics (times, names, channels, amounts). For list slots, put one item per line.
- quote: the exact words from the card that support it (copy them; keep it under 300 characters).
- document: the number of the document it came from. If two documents state the rule, report it once per document. If they disagree, report each version; don't pick one.
- partial: true when the card covers only part of what the slot asks.
Leave a slot out entirely when the cards don't cover it. Never invent rules or fill gaps with general best practice.

Edge cases: for each workflow listed, if the cards are silent on a risk the VA could realistically face in that workflow (for example an upset patient, a payment dispute, a possible emergency), write at most one short question for the doctor about how the VA should handle it. Skip workflows the cards already cover well.

The cards should contain no real patient information. If you notice any, don't copy it into a value or quote.`;

type SlotForExtraction = Pick<InterviewQuestion, "key" | "question" | "answer_type">;
export type DocumentForExtraction = { id: string; file_name: string; card_name: string; file_path: string };
export type Workflow = { code: string; name: string };

const FORMAT_HINT: Partial<Record<InterviewQuestion["answer_type"], string>> = {
  list: "list",
  yesno: "yes or no",
  upload: "text (scripts or templates: copy the wording)",
};

export function buildPrompt(slots: SlotForExtraction[], documents: DocumentForExtraction[], workflows: Workflow[]) {
  const docList = documents.map((d, i) => `Document ${i + 1}: ${d.card_name || "Card"} (${d.file_name})`).join("\n");
  const slotList = slots
    .map((s) => `- ${s.key} [${FORMAT_HINT[s.answer_type] ?? "text"}]: ${s.question}`)
    .join("\n");
  const workflowList = workflows.map((w) => `- ${w.code}: ${w.name}`).join("\n");
  return `Documents:\n${docList}\n\nRule slots:\n${slotList}\n\nWorkflows:\n${workflowList}`;
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

// Checks the model's output against the slots and documents it was given and
// shapes it into office_rules rows. Anything that doesn't fit is dropped.
export function toProposals(
  output: ExtractionOutput,
  slots: InterviewQuestion[],
  documents: DocumentForExtraction[],
  workflows: Workflow[],
) {
  const slotByKey = new Map(slots.map((s) => [s.key, s]));
  const rules = new Map<string, { rule_slot_key: string; source_document_id: string; rule: AnswerValue; source_quote: string; partial: boolean }>();
  for (const r of output.rules) {
    const slot = slotByKey.get(r.key);
    const doc = documents[r.document - 1];
    if (!slot || !doc || !r.value.trim()) continue;
    const rule = toAnswerValue(slot, r.value);
    if (rule === null || (Array.isArray(rule) && rule.length === 0) || checkAnswerValue(slot, rule) !== null) continue;
    // One proposal per slot and document (the table allows no more).
    rules.set(`${slot.key}|${doc.id}`, {
      rule_slot_key: slot.key,
      source_document_id: doc.id,
      rule,
      source_quote: r.quote.trim().slice(0, 1000),
      partial: r.partial,
    });
  }
  const codes = new Set(workflows.map((w) => w.code));
  const edgeCases = new Map<string, string>();
  for (const e of output.edge_cases) {
    const question = e.question.trim();
    if (codes.has(e.workflow) && question && !edgeCases.has(e.workflow)) edgeCases.set(e.workflow, question.slice(0, 500));
  }
  return { rules: [...rules.values()], edgeCases: [...edgeCases].map(([workflow, question]) => ({ workflow, question })) };
}

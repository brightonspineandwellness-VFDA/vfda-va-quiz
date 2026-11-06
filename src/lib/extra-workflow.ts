// Extra (gray) cards as workflows, as pure functions: what Claude is asked
// to read from an extra card (a mini workflow for office_workflows, WF-G1,
// WF-G2...), the checks on its answer, a stand-in without Claude, and the
// plan for the gray card day (W2D5): which cards get which items within the
// day's item count, which go to the phone days, and which are left out. No
// server-only imports, so tests can load it.

import { z } from "zod";
import { quoteIn } from "@/lib/card-map";

export const ExtraWorkflowSchema = z.object({
  name: z.string().describe("A short name for the process or information, e.g. 'Ordering supplies'"),
  kind: z.enum(["process", "info"]).describe('"process" when the card has steps to follow; "info" when it has none (links, videos, lists, reference)'),
  phone: z
    .enum(["none", "routine", "advanced"])
    .describe('"routine" or "advanced" when the process is a phone call (advanced: upset callers, emergencies, escalation); otherwise "none"'),
  trigger: z.string().describe("When the VA does this: what starts it"),
  steps: z.array(z.string()).describe("The steps in order, short, in the card's own sense (empty for info)"),
  definition_of_done: z.string().describe("What finished looks like"),
  va_can_decide: z.array(z.string()).describe("What the VA may decide alone"),
  requires_approval: z.array(z.string()).describe("What needs approval first, and whose"),
  immediate_escalation: z.array(z.string()).describe("What must be escalated at once, and to whom"),
  patient_facing: z.boolean().describe("true when the VA talks or writes to patients in this"),
  risky: z.boolean().describe("true when mistakes cost money, leak patient information, or touch legal or clinical matters"),
  quotes: z
    .array(z.object({ field: z.string().describe("trigger, steps, definition_of_done, va_can_decide, requires_approval or immediate_escalation"), quote: z.string() }))
    .describe("The card's exact words behind each field (copied, under 300 characters each)"),
});
export type ExtraWorkflowOutput = z.infer<typeof ExtraWorkflowSchema>;

export const EXTRA_SYSTEM = `You read one of a chiropractic office's extra Trello cards (a process or information the standard VA
training doesn't cover) and write it as a mini workflow for training its virtual assistant (VA). Use only what the card
says; never invent steps, approvals or escalations. Leave a list empty when the card says nothing about it. The cards
should contain no real patient information; if you notice any, don't copy it.`;

export const extraPrompt = (card: { title: string; text: string }) => `The card: ${card.title}

<card_text>
${card.text.slice(0, 30_000)}
</card_text>`;

export type ExtraWorkflow = {
  name: string;
  kind: "process" | "info";
  phone: "none" | "routine" | "advanced";
  trigger: string;
  steps: string[];
  definition_of_done: string;
  va_can_decide: string[];
  requires_approval: string[];
  immediate_escalation: string[];
  patient_facing: boolean;
  risky: boolean;
  source_quotes: { field: string; quote: string }[];
};

const FIELDS = ["trigger", "steps", "definition_of_done", "va_can_decide", "requires_approval", "immediate_escalation"];
const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean).slice(0, 40).map((x) => x.slice(0, 500));

// The model's answer, checked: quotes not on the card are dropped; a card with
// no steps is info only, and an info card has no steps or phone process.
export function toExtraWorkflow(out: ExtraWorkflowOutput, card: { title: string; text: string }): ExtraWorkflow {
  const steps = clean(out.steps);
  const kind = out.kind === "process" && steps.length ? "process" : "info";
  return {
    name: (out.name.trim() || card.title).slice(0, 200),
    kind,
    phone: kind === "process" ? out.phone : "none",
    trigger: out.trigger.trim().slice(0, 1000),
    steps: kind === "process" ? steps : [],
    definition_of_done: out.definition_of_done.trim().slice(0, 1000),
    va_can_decide: clean(out.va_can_decide),
    requires_approval: clean(out.requires_approval),
    immediate_escalation: clean(out.immediate_escalation),
    patient_facing: out.patient_facing,
    risky: out.risky,
    source_quotes: out.quotes
      .filter((q) => FIELDS.includes(q.field) && quoteIn(q.quote, card.text))
      .map((q) => ({ field: q.field, quote: q.quote.trim().slice(0, 300) })),
  };
}

const STEP_LINE = /^\s*(?:\d+[.)]|[-*•]|\[[ x]?\])\s+(.+)$/i;
const CALL = /\b(phone|call(s|er|ing)?|voicemail)\b/i;
const ADVANCED = /\b(upset|angry|emergenc|911|escalat|complain)/i;

// Without Claude (AI_MODE=mock): numbered or bulleted lines are the steps.
export function mockExtraWorkflow(card: { title: string; text: string }): ExtraWorkflow {
  const lines = card.text.split(/\r?\n/);
  const steps = lines.map((l) => STEP_LINE.exec(l)?.[1]?.trim()).filter((s): s is string => !!s);
  const kind = steps.length >= 2 ? "process" : "info";
  const firstQuote = (kind === "process" ? lines.find((l) => STEP_LINE.test(l)) : lines.find((l) => l.trim()))?.trim() ?? "";
  return {
    name: card.title.slice(0, 200),
    kind,
    phone: kind === "process" && CALL.test(card.text) ? (ADVANCED.test(card.text) ? "advanced" : "routine") : "none",
    trigger: kind === "process" ? `When ${card.title.toLowerCase()} comes up` : "",
    steps: kind === "process" ? steps : [],
    definition_of_done: kind === "process" ? `Every step of "${card.title}" is done` : "",
    va_can_decide: [],
    requires_approval: lines.filter((l) => /\bapprov/i.test(l)).map((l) => l.trim()),
    immediate_escalation: lines.filter((l) => /\bescalat/i.test(l)).map((l) => l.trim()),
    patient_facing: /\bpatient/i.test(card.text),
    risky: /\b(refund|write-?off|legal|attorney|hipaa|privacy|clinical)\b/i.test(card.text),
    source_quotes: firstQuote ? [{ field: kind === "process" ? "steps" : "trigger", quote: firstQuote.slice(0, 300) }] : [],
  };
}

// WF-G1, WF-G2...: the next code not used by the office.
export function nextGrayCode(used: string[]) {
  const n = Math.max(0, ...used.map((c) => Number(/^WF-G(\d+)$/.exec(c)?.[1] ?? 0)));
  return `WF-G${n + 1}`;
}

// ---------------------------------------------------------------------------
// Building from the workflows
// ---------------------------------------------------------------------------

export type ExtraWorkflowRow = ExtraWorkflow & {
  id: string;
  code: string;
  position: number;
  approved_at: string | null;
  card: { id: string; title: string; text: string } | null;
};

// A phone-call process is trained with the calls: W2D1 if routine, W2D2 if not.
export const phoneDay = (w: Pick<ExtraWorkflow, "kind" | "phone">) =>
  w.kind !== "process" || w.phone === "none" ? null : w.phone === "routine" ? "W2D1" : "W2D2";

const rank = (w: Pick<ExtraWorkflow, "patient_facing" | "risky">) => Number(w.patient_facing) + Number(w.risky);
const byRank = <T extends ExtraWorkflowRow>(xs: T[]) => [...xs].sort((a, b) => rank(b) - rank(a) || a.position - b.position);

export type PlannedItem = { key: string; workflow: ExtraWorkflowRow; type: "situational" | "mc" | "info" };
export type LeftOut = { code: string; name: string; reason: string };

// W2D5: one situational item per process card (patient-facing and risky
// first), then one question per info card, then a multiple choice per process
// card while there's room, never more than `cap` items. Phone processes go to
// the phone days; cards that don't fit are left out (listed for VFDA).
export function planExtraDay(workflows: ExtraWorkflowRow[], cap: number): { items: PlannedItem[]; leftOut: LeftOut[] } {
  const approved = workflows.filter((w) => w.approved_at && w.card);
  const process = byRank(approved.filter((w) => w.kind === "process" && !phoneDay(w)));
  const info = byRank(approved.filter((w) => w.kind === "info"));
  const items: PlannedItem[] = [];
  const leftOut: LeftOut[] = [];
  const add = (workflow: ExtraWorkflowRow, type: PlannedItem["type"]) => items.push({ key: `E${items.length + 1}`, workflow, type });
  for (const w of process) {
    if (items.length < cap) add(w, "situational");
    else leftOut.push({ code: w.code, name: w.name, reason: `more process cards than the day's ${cap} items (ranked: patient-facing and risky first)` });
  }
  for (const w of info) {
    if (items.length < cap) add(w, "info");
    else leftOut.push({ code: w.code, name: w.name, reason: `no room left in the day's ${cap} items` });
  }
  for (const w of process) {
    if (items.length >= cap) break;
    if (items.some((i) => i.workflow === w)) add(w, "mc");
  }
  return { items, leftOut };
}

// The phone days' extra items: one situational per phone process for that day.
export function planPhoneItems(workflows: ExtraWorkflowRow[], day: string): PlannedItem[] {
  return byRank(workflows.filter((w) => w.approved_at && w.card && phoneDay(w) === day)).map((workflow, n) => ({
    key: `X${n + 1}`,
    workflow,
    type: "situational" as const,
  }));
}

// A situational item's answer key comes from the card itself: its steps in
// order; skipping a required approval or escalation is the critical fail.
export function processKey(w: Pick<ExtraWorkflow, "steps" | "requires_approval" | "immediate_escalation">) {
  const must = [...w.requires_approval.map((a) => `getting approval: ${a}`), ...w.immediate_escalation.map((e) => `escalating at once: ${e}`)];
  return {
    correct_response: w.steps,
    critical_fail: must.length ? `Skips ${must.join("; or ")}` : null,
    escalation_level: (w.immediate_escalation.length ? "immediate" : w.requires_approval.length ? "approval" : "none") as "immediate" | "approval" | "none",
  };
}

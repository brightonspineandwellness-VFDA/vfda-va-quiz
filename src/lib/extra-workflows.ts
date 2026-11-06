import "server-only";

// Extra (gray) cards on the server: each extra card (a card mapped to the
// gray card day, W2D5) is read once into a mini workflow in office_workflows
// (WF-G1, WF-G2...) for VFDA to edit and approve; the approved ones are
// turned into scenario drafts for W2D5, or for W2D1 / W2D2 when the process
// is a phone call. Service role; AI_MODE=mock reads cards without Claude.

import { aiMode, askStructured } from "@/lib/ai";
import { GRAY_DAY } from "@/lib/card-map";
import { checkDayItem, type DayRules } from "@/lib/day-rules";
import {
  EXTRA_SYSTEM,
  ExtraWorkflowSchema,
  extraPrompt,
  mockExtraWorkflow,
  nextGrayCode,
  processKey,
  toExtraWorkflow,
  type ExtraWorkflow,
  type ExtraWorkflowRow,
  type PlannedItem,
} from "@/lib/extra-workflow";
import { writeExtraItems } from "@/lib/scenario-ai";
import type { DraftScenario } from "@/lib/scenario-build";
import { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const WORKFLOW_COLUMNS =
  "id, code, name, kind, phone, trigger, steps, definition_of_done, va_can_decide, requires_approval, immediate_escalation, patient_facing, risky, source_quotes, approved_at, position, source_document_id";

type DocRow = { id: string; card_title: string; file_name: string; extracted_text: string | null; schedule_days: string[]; skip: boolean };

const cardOf = (d: DocRow) => ({ id: d.id, title: d.card_title || d.file_name, text: d.extracted_text ?? "" });

// The office's extra cards (mapped to W2D5, read, with text).
async function extraCards(db: Db, officeId: string) {
  const docs = (must(
    await db
      .from("office_documents")
      .select("id, card_title, file_name, extracted_text, schedule_days, skip")
      .eq("office_id", officeId)
      .eq("kind", "card")
      .eq("skip", false)
      .not("imported_at", "is", null)
      .contains("schedule_days", [GRAY_DAY])
      .order("created_at"),
  ) ?? []) as DocRow[];
  return docs.filter((d) => d.extracted_text?.trim());
}

async function readWorkflow(card: { title: string; text: string }): Promise<ExtraWorkflow> {
  if (aiMode() === "mock") return mockExtraWorkflow(card);
  const out = await askStructured(ExtraWorkflowSchema, {
    system: EXTRA_SYSTEM,
    effort: "medium",
    maxTokens: 16000,
    content: [{ type: "text", text: extraPrompt(card) }],
  });
  return toExtraWorkflow(out, card);
}

const workflowFields = (w: ExtraWorkflow) => ({
  name: w.name,
  kind: w.kind,
  phone: w.phone,
  trigger: w.trigger,
  steps: w.steps,
  definition_of_done: w.definition_of_done,
  va_can_decide: w.va_can_decide,
  requires_approval: w.requires_approval,
  immediate_escalation: w.immediate_escalation,
  patient_facing: w.patient_facing,
  risky: w.risky,
  source_quotes: w.source_quotes,
});

// Reads every extra card that has no workflow yet into one (as a draft for
// VFDA). Returns how many were read, and the errors (one card failing
// doesn't stop the rest).
export async function extractExtraWorkflows(officeId: string): Promise<{ read: number; errors: string[] }> {
  const db = createAdminClient();
  const [cards, existing] = await Promise.all([
    extraCards(db, officeId),
    db.from("office_workflows").select("code, source_document_id, position").eq("office_id", officeId),
  ]);
  const rows = (must(existing) ?? []) as { code: string; source_document_id: string | null; position: number }[];
  const todo = cards.filter((c) => !rows.some((r) => r.source_document_id === c.id));
  const errors: string[] = [];
  let read = 0;
  for (const doc of todo) {
    try {
      const w = await readWorkflow(cardOf(doc));
      const code = nextGrayCode(rows.map((r) => r.code));
      const position = Math.max(0, ...rows.map((r) => r.position)) + 1;
      must(
        await db
          .from("office_workflows")
          .insert({ office_id: officeId, code, position, source_document_id: doc.id, card_answers: { CARD_NAME: w.name }, ...workflowFields(w) }),
      );
      rows.push({ code, source_document_id: doc.id, position });
      // The card now feeds this workflow.
      await db.from("office_documents").update({ workflow: code }).eq("id", doc.id);
      read++;
    } catch (e) {
      errors.push(`${cardOf(doc).title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) console.error("Extra card workflows not read", officeId, errors);
  return { read, errors };
}

// "Read the card again": replaces the workflow's fields and clears its approval.
export async function reextractExtraWorkflow(workflowId: string): Promise<string | null> {
  const db = createAdminClient();
  const row = must(await db.from("office_workflows").select("id, source_document_id").eq("id", workflowId).maybeSingle()) as {
    id: string;
    source_document_id: string | null;
  } | null;
  if (!row?.source_document_id) return "This workflow has no card to read.";
  const doc = must(
    await db.from("office_documents").select("id, card_title, file_name, extracted_text, schedule_days, skip").eq("id", row.source_document_id).maybeSingle(),
  ) as DocRow | null;
  if (!doc?.extracted_text?.trim()) return "The card has no text to read.";
  const w = await readWorkflow(cardOf(doc));
  must(await db.from("office_workflows").update({ ...workflowFields(w), approved_at: null, approved_by: null }).eq("id", row.id));
  return null;
}

// The office's extra workflows with their cards (cards no longer mapped to
// W2D5 are left out: they aren't extra cards any more).
export async function loadExtraWorkflows(db: Db, officeId: string): Promise<ExtraWorkflowRow[]> {
  const [rows, cards] = await Promise.all([
    db.from("office_workflows").select(WORKFLOW_COLUMNS).eq("office_id", officeId).not("source_document_id", "is", null).order("position"),
    extraCards(db, officeId),
  ]);
  return ((must(rows) ?? []) as (ExtraWorkflow & { id: string; code: string; position: number; approved_at: string | null; source_document_id: string })[])
    .map((w) => {
      const doc = cards.find((c) => c.id === w.source_document_id);
      return { ...w, card: doc ? cardOf(doc) : null };
    })
    .filter((w) => w.card);
}

// The planned items written and turned into drafts (codes G1... on W2D5,
// X1... on a phone day), checked against the day rules.
export async function extraDrafts(input: { day: string; planned: PlannedItem[]; rules: DayRules; prefix: string; startAt: number }): Promise<DraftScenario[]> {
  const written = await writeExtraItems({
    day: input.day,
    rules: input.rules,
    items: input.planned.map((p) => ({
      key: p.key,
      type: p.type,
      card: p.workflow.card!,
      workflow: p.workflow,
      fallbackQuote: p.workflow.source_quotes[0]?.quote ?? p.workflow.card!.text.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 300) ?? p.workflow.name,
    })),
  });
  return input.planned.map((p, n) => {
    const w = p.workflow;
    const item = written.get(p.key)!;
    const key = processKey(w);
    const situational = item.type === "situational";
    const draft: DraftScenario = {
      scenario_id: null,
      office_workflow_id: w.id,
      workflow: w.code,
      part: "G",
      part_title: w.name,
      code: `${input.prefix}${n + 1}`,
      type: item.type,
      points: item.type === "mc" ? 1 : 2,
      answer_format: situational ? "steps_say_doc" : null,
      stem: item.stem,
      options: item.options,
      answer: item.answer,
      // A process card's own steps, in order, are the answer.
      correct_response: situational ? key.correct_response : item.type === "describe" ? item.key_points : null,
      critical_fail: situational ? key.critical_fail : null,
      escalation_level: situational ? key.escalation_level : "none",
      formula: null,
      missing_keys: [],
      options_rule: null,
      wants_repeat: situational,
      position: input.startAt + n,
      source_card: w.card!.title,
      source_quote: item.source_quote,
      source_document_id: w.card!.id,
    };
    const broken = checkDayItem(draft, input.day, input.rules);
    return broken ? { ...draft, review_error: `${broken.field}: ${broken.reason}` } : draft;
  });
}

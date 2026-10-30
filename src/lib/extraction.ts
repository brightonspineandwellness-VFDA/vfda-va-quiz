import "server-only";

// Rule extraction (Phase 3b): reads an office's new card PDFs with the Claude
// API and writes what it finds as proposed office rules (source card_import,
// with the exact quote and the card it came from) for VFDA to review. It also
// proposes at most one edge-case question per workflow where the cards are
// silent on a risk; those wait for VFDA too (gap_questions, not released).
//
// Runs on the server with the service role, after "Done uploading". Only
// documents not read before (imported_at is null) are sent. Slots the doctor
// or VFDA already answered are skipped, so their answers are never overwritten.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { directAnswer, slotApplies, type RuleRow } from "@/lib/doctor-flow";
import {
  buildPrompt,
  ExtractionSchema,
  SYSTEM,
  toProposals,
  type DocumentForExtraction,
  type Workflow,
} from "@/lib/extraction-parse";
import { profileFromAnswers, type Answer, type InterviewQuestion } from "@/lib/interview";
import { createAdminClient } from "@/lib/supabase/server";

export const DOCUMENT_BUCKET = "office-documents";
const MODEL = "claude-opus-5-5";
// Stay well under the API's 32 MB request limit (base64 adds a third).
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
// A run that has said "running" this long is treated as dead and may restart.
const STALE_RUN_MS = 20 * 60 * 1000;

async function callClaude(prompt: string, pdfs: { title: string; data: string }[]) {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(ExtractionSchema) },
    // If the model declines, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...pdfs.map((pdf) => ({
            type: "document" as const,
            title: pdf.title,
            source: { type: "base64" as const, media_type: "application/pdf" as const, data: pdf.data },
          })),
          { type: "text" as const, text: prompt },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined to read these cards.");
  if (message.stop_reason === "max_tokens") throw new Error("The cards were too long to read in one go.");
  if (!message.parsed_output) throw new Error("The model's answer couldn't be read.");
  return message.parsed_output;
}

// Groups documents so each request stays under the size limit.
function batches<T extends { size: number }>(items: T[]) {
  const out: T[][] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.reduce((n, i) => n + i.size, 0) + item.size <= MAX_BATCH_BYTES) last.push(item);
    else out.push([item]);
  }
  return out;
}

const messageOf = (e: unknown) =>
  e instanceof Anthropic.APIError ? `Claude API error ${e.status ?? ""}: ${e.message}` : e instanceof Error ? e.message : String(e);

export async function runExtraction(officeId: string) {
  const db = createAdminClient();

  // Claim the run, so two clicks don't read the same cards twice.
  const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from("offices")
    .update({ extraction_status: "running", extraction_started_at: new Date().toISOString(), extraction_error: null })
    .eq("id", officeId)
    .or(`extraction_status.neq.running,extraction_started_at.lt.${staleBefore}`)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return;

  try {
    const [docs, slots, days, settings, rules, workflows, gaps] = await Promise.all([
      db
        .from("office_documents")
        .select("id, file_name, card_name, file_path")
        .eq("office_id", officeId)
        .eq("kind", "card")
        .is("imported_at", null)
        .order("created_at"),
      db
        .from("rule_slots")
        .select("key, tier, card_group, suggested_answer, schedule_day, question, answer_type, condition, card_source, workflows")
        .in("tier", ["profile", "doctor", "default"])
        .order("position"),
      db.from("schedule_days").select("code, condition"),
      db.from("settings").select("value").eq("key", "conditions").maybeSingle(),
      db
        .from("office_rules")
        .select("id, rule_slot_key, rule, attachments, source, source_document_id, source_quote, status, partial, doctor_approved_at")
        .eq("office_id", officeId),
      db.from("workflows").select("code, name").order("position"),
      db.from("gap_questions").select("workflow").eq("office_id", officeId).eq("reason", "edge_case"),
    ]);
    for (const r of [docs, slots, days, settings, rules, workflows, gaps]) if (r.error) throw r.error;

    const documents = (docs.data ?? []) as DocumentForExtraction[];
    if (documents.length > 0) {
      const ruleRows = (rules.data ?? []).map((r) => ({ ...r, document_name: null })) as RuleRow[];
      const questions = (slots.data ?? []).map(
        (s): InterviewQuestion & { workflows: string[] } => ({
          key: s.key,
          tier: s.tier,
          card_group: s.card_group,
          suggested_answer: s.suggested_answer,
          quiz: s.schedule_day,
          question: s.question,
          answer_type: s.answer_type,
          condition: s.condition,
          source: s.card_source,
          workflows: s.workflows ?? [],
        }),
      );
      const answers = Object.fromEntries(
        ruleRows
          .filter((r) => r.source_document_id === null)
          .map((r) => [r.rule_slot_key, { value: r.rule, attachments: r.attachments ?? [] } as Answer]),
      );
      const flowInput = {
        dayConditions: Object.fromEntries((days.data ?? []).map((d) => [d.code, d.condition])),
        conditions: (settings.data?.value ?? {}) as Record<string, string>,
        profile: profileFromAnswers(answers),
      };
      const wanted = questions.filter(
        (s) =>
          s.tier !== "profile" &&
          s.answer_type !== "matrix" &&
          slotApplies(s, flowInput) &&
          !directAnswer(s, ruleRows.filter((r) => r.rule_slot_key === s.key)),
      );
      // One edge case per workflow: skip workflows that already have one.
      const asked = new Set((gaps.data ?? []).map((g) => g.workflow));
      const openWorkflows = ((workflows.data ?? []) as Workflow[]).filter((w) => !asked.has(w.code));

      const files = await Promise.all(
        documents.map(async (doc) => {
          const { data, error } = await db.storage.from(DOCUMENT_BUCKET).download(doc.file_path);
          if (error || !data) throw new Error(`Couldn't open ${doc.file_name}.`);
          const bytes = Buffer.from(await data.arrayBuffer());
          return { doc, size: bytes.length, data: bytes.toString("base64") };
        }),
      );

      const now = new Date().toISOString();
      for (const batch of batches(files)) {
        const batchDocs = batch.map((f) => f.doc);
        const output = await callClaude(
          buildPrompt(wanted, batchDocs, openWorkflows),
          batch.map((f) => ({ title: `${f.doc.card_name || "Card"}: ${f.doc.file_name}`, data: f.data })),
        );
        const { rules: found, edgeCases } = toProposals(output, wanted, batchDocs, openWorkflows);
        const slotWorkflows = new Map(questions.map((q) => [q.key, q.workflows]));

        if (found.length) {
          const { error } = await db.from("office_rules").upsert(
            found.map((r) => ({
              ...r,
              office_id: officeId,
              source: "card_import",
              status: "proposed",
              workflows: slotWorkflows.get(r.rule_slot_key) ?? [],
              vfda_reviewed_by: null,
              vfda_reviewed_at: null,
              doctor_approved_by: null,
              doctor_approved_at: null,
            })),
            { onConflict: "office_id,rule_slot_key,source_document_id" },
          );
          if (error) throw error;
        }
        for (const e of edgeCases) {
          if (asked.has(e.workflow)) continue;
          asked.add(e.workflow);
          const { error } = await db
            .from("gap_questions")
            .insert({ office_id: officeId, workflow: e.workflow, question: e.question, reason: "edge_case" });
          // 23505: another run already added one for this workflow.
          if (error && error.code !== "23505") throw error;
        }
        const { error } = await db
          .from("office_documents")
          .update({ imported_at: now })
          .in(
            "id",
            batchDocs.map((d) => d.id),
          );
        if (error) throw error;
      }
    }

    await db
      .from("offices")
      .update({ extraction_status: "done", extracted_at: new Date().toISOString(), extraction_error: null })
      .eq("id", officeId);
  } catch (e) {
    console.error("Rule extraction failed", officeId, e);
    await db
      .from("offices")
      .update({ extraction_status: "failed", extraction_error: messageOf(e).slice(0, 500) })
      .eq("id", officeId);
  }
}

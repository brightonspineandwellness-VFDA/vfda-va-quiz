import "server-only";

// Reading card PDFs (card-first setup): each new card is read with the Claude
// API once, for its title, color, word-for-word text and a suggested mapping
// to training day(s) and a workflow, plus any VFDA standard or must-ask rule
// it states (proposed office rules with the exact quote, for VFDA to review).
// The text is what scenarios are later written from.
//
// Runs on the server with the service role, after "Done uploading". Only
// documents not read before (imported_at is null) are sent. Slots the doctor
// or VFDA already answered are skipped, so their answers are never overwritten.
// AI_MODE=mock records the cards without reading them.

import { aiErrorMessage, aiMode, askStructured } from "@/lib/ai";
import { isMustAsk, suggestMapping, type DayForMapping } from "@/lib/card-map";
import { directAnswer, slotApplies, type RuleRow } from "@/lib/doctor-flow";
import {
  buildPrompt,
  CardReadSchema,
  SYSTEM,
  toReading,
  type CardReading,
  type DocumentForExtraction,
  type Workflow,
} from "@/lib/extraction-parse";
import { profileFromAnswers, type Answer, type InterviewQuestion } from "@/lib/interview";
import { createAdminClient } from "@/lib/supabase/server";

export const DOCUMENT_BUCKET = "office-documents";
// Stay well under the API's 32 MB request limit (base64 adds a third).
const MAX_CARD_BYTES = 20 * 1024 * 1024;
// A run that has said "running" this long is treated as dead and may restart.
const STALE_RUN_MS = 20 * 60 * 1000;
// Cards read at the same time.
const PARALLEL = 4;

function readCard(prompt: string, title: string, data: string) {
  return askStructured(CardReadSchema, {
    system: SYSTEM,
    effort: "medium",
    maxTokens: 64000,
    content: [
      { type: "document", title, source: { type: "base64", media_type: "application/pdf", data } },
      { type: "text", text: prompt },
    ],
  });
}

// Runs `work` on every item, at most `limit` at a time; collects the errors.
async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const errors: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await work(item);
        } catch (e) {
          errors.push(aiErrorMessage(e));
        }
      }
    }),
  );
  return errors;
}

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
    const [docs, slots, days, settings, rules, workflows, grayWorkflows] = await Promise.all([
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
      db.from("schedule_days").select("code, condition, cards, workflows"),
      db.from("settings").select("value").eq("key", "conditions").maybeSingle(),
      db
        .from("office_rules")
        .select("id, rule_slot_key, rule, attachments, source, source_document_id, source_quote, status, partial, doctor_approved_at")
        .eq("office_id", officeId),
      db.from("workflows").select("code, name").order("position"),
      db.from("office_workflows").select("code, name").eq("office_id", officeId).order("position"),
    ]);
    for (const r of [docs, slots, days, settings, rules, workflows, grayWorkflows]) if (r.error) throw r.error;

    const documents = (docs.data ?? []) as DocumentForExtraction[];
    const ruleRows = (rules.data ?? []).map((r) => ({ ...r, document_name: null })) as RuleRow[];
    const questions = (slots.data ?? []).map(
      (s): InterviewQuestion => ({
        key: s.key,
        tier: s.tier,
        card_group: s.card_group,
        suggested_answer: s.suggested_answer,
        quiz: s.schedule_day,
        question: s.question,
        answer_type: s.answer_type,
        condition: s.condition,
        source: s.card_source,
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
    // Only VFDA standards and the must-ask rules are still filled from cards.
    const wanted = questions.filter(
      (s) =>
        (s.tier === "default" || (s.tier === "doctor" && isMustAsk(s.key))) &&
        s.answer_type !== "matrix" &&
        slotApplies(s, flowInput) &&
        !directAnswer(s, ruleRows.filter((r) => r.rule_slot_key === s.key)),
    );
    const workflowList = [...((workflows.data ?? []) as Workflow[]), ...((grayWorkflows.data ?? []) as Workflow[])];
    const dayList = (days.data ?? []).map((d) => ({ code: d.code, cards: d.cards ?? [], workflows: d.workflows ?? [] })) as DayForMapping[];
    const slotWorkflows = new Map((slots.data ?? []).map((s) => [s.key as string, (s.workflows ?? []) as string[]]));
    const mock = aiMode() === "mock";

    const errors = await eachLimited(documents, PARALLEL, async (doc) => {
      let reading: CardReading;
      let found: ReturnType<typeof toReading>["rules"] = [];
      if (mock) {
        const title = doc.card_name || doc.file_name.replace(/\.pdf$/i, "");
        reading = {
          card_title: title,
          card_color: null,
          extracted_text: `(AI_MODE=mock: the card wasn't read) ${title}`,
          skip: false,
          workflow: null,
          tags: [],
        };
      } else {
        const { data, error } = await db.storage.from(DOCUMENT_BUCKET).download(doc.file_path);
        if (error || !data) throw new Error(`Couldn't open ${doc.file_name}.`);
        const bytes = Buffer.from(await data.arrayBuffer());
        if (bytes.length > MAX_CARD_BYTES) throw new Error(`${doc.file_name} is too big to read (over 20 MB).`);
        const output = await readCard(
          buildPrompt(wanted, doc, workflowList),
          `${doc.card_name || "Card"}: ${doc.file_name}`,
          bytes.toString("base64"),
        );
        ({ reading, rules: found } = toReading(output, wanted, doc, workflowList));
      }
      const suggestion = suggestMapping(
        { title: reading.card_title, cardName: doc.card_name, color: reading.card_color, workflow: reading.workflow },
        dayList,
      );

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
      const { error } = await db
        .from("office_documents")
        .update({
          ...reading,
          workflow: suggestion.workflow,
          schedule_days: suggestion.days,
          imported_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
      if (error) throw error;
    });
    if (errors.length) throw new Error(errors[0]);

    await db
      .from("offices")
      .update({ extraction_status: "done", extracted_at: new Date().toISOString(), extraction_error: null })
      .eq("id", officeId);
  } catch (e) {
    console.error("Reading cards failed", officeId, e);
    await db
      .from("offices")
      .update({ extraction_status: "failed", extraction_error: aiErrorMessage(e).slice(0, 500) })
      .eq("id", officeId);
  }
}

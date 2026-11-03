"use server";

// VFDA's scenario review (/admin/offices/[id]/scenarios): build or rebuild a
// day, edit, regenerate or remove a scenario, approve a day (sets it live for
// VAs; not while an item needs review) or reopen it. VFDA admins only.
// Building runs after the response is sent.

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { GRAY_DAY } from "@/lib/card-map";
import { regenerateCardItem, writeVariants, type CheckFailure } from "@/lib/scenario-ai";
import { checkMc, correctResponseFromText, placeholdersIn, type CorrectResponse } from "@/lib/scenario-build";
import { buildOfficeDay, claimBuild, dayHasAttempts, loadDaySources, loadOfficeBuild, logCheckFailures } from "@/lib/scenario-builder";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_CODE = /^W\dD\d$/;
const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

export async function buildDay(officeId: string, day: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(officeId) || !DAY_CODE.test(day)) return fail("Invalid request.");
  const db = createAdminClient();
  const ctx = await loadOfficeBuild(db, officeId);
  const entry = ctx?.days.find((d) => d.day.code === day);
  if (!entry) return fail("This day isn't part of the office's training.");
  if (await dayHasAttempts(db, officeId, day)) return fail("A VA has already started this day; it can't be rebuilt.");
  if (!(await claimBuild(officeId, day, entry.kind))) return fail("This day is already being built.");
  after(() => buildOfficeDay(officeId, day));
  return { ok: true, data: null };
}

export async function approveDay(officeId: string, day: string): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(officeId) || !DAY_CODE.test(day)) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const [{ data: status }, { data: scenarios }] = await Promise.all([
    supabase.from("office_days").select("build_status").eq("office_id", officeId).eq("schedule_day", day).maybeSingle(),
    supabase
      .from("office_scenarios")
      .select("version, type, options, missing_keys, is_repeat_variant, test_status")
      .eq("office_id", officeId)
      .eq("schedule_day", day),
  ]);
  if (status?.build_status !== "done") return fail("Build the day first.");
  // One attempt per day: only version A is used (older builds may still have a version B).
  const rows = (scenarios ?? []).filter((r) => r.version === "A");
  if (!rows.some((r) => !r.is_repeat_variant)) return fail("This day has no scenarios.");
  const review = rows.filter((r) => r.test_status === "needs_review").length;
  if (review) return fail(`${review} item(s) need review first: edit, regenerate or remove them.`);
  const missing = rows.filter((r) => r.missing_keys.length > 0).length;
  if (missing) return fail(`${missing} scenario(s) still need office rules. Edit them, or add the rules and rebuild.`);
  if (rows.some((r) => r.type === "mc" && !r.options)) return fail("A multiple choice question has no options yet.");

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("office_scenarios")
    .update({ test_status: "live" })
    .eq("office_id", officeId)
    .eq("schedule_day", day);
  if (error) return fail("Couldn't approve. Try again.");
  await supabase
    .from("office_days")
    .update({ approved_at: now, approved_by: user.id })
    .eq("office_id", officeId)
    .eq("schedule_day", day);

  // Every day approved: the office moves on to VA training.
  const db = createAdminClient();
  const ctx = await loadOfficeBuild(db, officeId);
  const { data: approved } = await supabase
    .from("office_days")
    .select("schedule_day")
    .eq("office_id", officeId)
    .not("approved_at", "is", null);
  const done = new Set((approved ?? []).map((d) => d.schedule_day));
  if (ctx && ctx.days.every((d) => done.has(d.day.code))) {
    await supabase.from("offices").update({ status: "va_training" }).eq("id", officeId).eq("status", "scenarios_in_review");
  }
  return { ok: true, data: null };
}

// Takes a day back from VAs to change it. Not once a VA has started it.
export async function reopenDay(officeId: string, day: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(officeId) || !DAY_CODE.test(day)) return fail("Invalid request.");
  if (await dayHasAttempts(createAdminClient(), officeId, day)) return fail("A VA has already started this day.");
  const supabase = await createSessionClient();
  const { error } = await supabase
    .from("office_scenarios")
    .update({ test_status: "vfda_reviewed" })
    .eq("office_id", officeId)
    .eq("schedule_day", day);
  if (error) return fail("Couldn't reopen. Try again.");
  await supabase
    .from("office_days")
    .update({ approved_at: null, approved_by: null })
    .eq("office_id", officeId)
    .eq("schedule_day", day);
  return { ok: true, data: null };
}

export type ScenarioEdit = {
  stem: string;
  options: string; // one per line (multiple choice)
  answer: string; // letter (multiple choice)
  correctResponse: string; // one step per line, or Say:/Do:/Book: headings
  criticalFail: string;
};

export async function editScenario(scenarioId: string, edit: ScenarioEdit): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(scenarioId)) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const { data: row } = await supabase
    .from("office_scenarios")
    .select("office_id, schedule_day, type, correct_response, test_status, is_repeat_variant, review_error")
    .eq("id", scenarioId)
    .maybeSingle();
  if (!row) return fail("Scenario not found.");
  if (row.test_status === "live") return fail("This day is approved. Reopen it to make changes.");

  const stem = edit.stem.trim().slice(0, 4000);
  if (!stem) return fail("The question can't be empty.");
  const update: Record<string, unknown> = { stem, edited_by_vfda: true };
  if (!row.is_repeat_variant) {
    if (row.type === "mc") {
      const options = edit.options.split("\n").map((o) => o.trim()).filter(Boolean);
      const answer = edit.answer.trim().toUpperCase();
      const bad = checkMc(options, answer);
      if (bad) return fail(`Multiple choice ${bad}.`);
      update.options = options;
      update.answer = answer;
    } else {
      const cr = row.correct_response;
      const keys = cr && !Array.isArray(cr) ? Object.keys(cr) : null;
      const parsed = correctResponseFromText(edit.correctResponse, keys);
      if (typeof parsed === "string") return fail(parsed);
      update.correct_response = parsed;
      update.critical_fail = edit.criticalFail.trim() || null;
    }
  }
  // Whatever {PLACEHOLDERS} are left still need a rule.
  const { data: current } = await supabase
    .from("office_scenarios")
    .select("stem, options, answer, correct_response, critical_fail")
    .eq("id", scenarioId)
    .single();
  update.missing_keys = placeholdersIn({ ...current, ...update, edited_by_vfda: undefined });
  // VFDA's edit settles an item that needed review.
  if (row.test_status === "needs_review") Object.assign(update, { test_status: "draft", review_error: null });
  const { error } = await supabase.from("office_scenarios").update(update).eq("id", scenarioId).neq("test_status", "live");
  if (error) return fail("Couldn't save. Try again.");
  if (row.test_status === "needs_review" && row.type === "situational") after(() => addRepeat(scenarioId));
  return { ok: true, data: null };
}

// A repeat variant for an item that just stopped needing review (it was skipped at build time).
async function addRepeat(scenarioId: string) {
  const db = createAdminClient();
  const { data: row } = await db.from("office_scenarios").select("*").eq("id", scenarioId).maybeSingle();
  if (!row || row.type !== "situational" || row.test_status !== "draft") return;
  const { data: existing } = await db.from("office_scenarios").select("id").eq("parent_scenario_id", scenarioId).limit(1);
  if (existing?.length) return;
  try {
    const variants = await writeVariants([{ ...row, options_rule: null, wants_repeat: true }], []);
    const stem = variants.get(row.code)?.repeat_stem;
    if (!stem) return;
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = row;
    void _id;
    void _c;
    void _u;
    await db
      .from("office_scenarios")
      .insert({ ...rest, id: crypto.randomUUID(), stem, options: null, answer: null, is_repeat_variant: true, parent_scenario_id: scenarioId });
  } catch (e) {
    console.error("Repeat variant not written", scenarioId, e);
  }
}

async function reviewableItem(scenarioId: string) {
  const supabase = await createSessionClient();
  const { data: row } = await supabase
    .from("office_scenarios")
    .select("id, office_id, schedule_day, code, type, workflow, part_title, stem, options, answer, correct_response, critical_fail, escalation_level, source_card, source_quote, test_status, review_error, is_repeat_variant")
    .eq("id", scenarioId)
    .maybeSingle();
  return row;
}

// "Regenerate": Claude rewrites the item from the day's cards, told what was
// wrong. Still failing, it stays "needs review" with the new error.
export async function regenerateScenario(scenarioId: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(scenarioId)) return fail("Invalid request.");
  const row = await reviewableItem(scenarioId);
  if (!row || row.is_repeat_variant) return fail("Scenario not found.");
  if (row.test_status === "live") return fail("This day is approved. Reopen it to make changes.");
  const db = createAdminClient();
  if (await dayHasAttempts(db, row.office_id, row.schedule_day)) return fail("A VA has already started this day.");
  const failures: CheckFailure[] = [];
  try {
    const src = await loadDaySources(db, row.office_id, row.schedule_day);
    if (!src.cards.length) return fail("No card is mapped to this day: edit the item instead.");
    const cr = row.correct_response as CorrectResponse | null;
    const item = await regenerateCardItem({
      item: {
        code: row.code,
        type: row.type,
        workflow: row.workflow,
        part_title: row.part_title,
        stem: row.stem,
        options: row.options,
        answer: row.answer,
        correct_response: cr ? (Array.isArray(cr) ? [{ box: null, steps: cr }] : Object.entries(cr).map(([box, steps]) => ({ box, steps }))) : null,
        critical_fail: row.critical_fail,
        escalation_level: row.escalation_level,
        source_card: row.source_card ?? "",
        source_quote: row.source_quote ?? "",
      },
      problem: row.review_error ?? "VFDA asked for a new version of this item",
      cards: src.cards,
      workflows: src.workflows,
      standards: src.standards,
      boxes: row.schedule_day === GRAY_DAY ? null : src.boxes,
      gray: row.schedule_day === GRAY_DAY,
      log: (f) => failures.push(f),
    });
    const { error } = await db
      .from("office_scenarios")
      .update({
        stem: item.stem,
        options: item.options,
        answer: item.answer,
        correct_response: item.correct_response,
        critical_fail: item.critical_fail,
        escalation_level: item.escalation_level,
        workflow: item.workflow,
        part_title: item.part_title || row.part_title,
        source_card: item.source_card,
        source_quote: item.source_quote,
        source_document_id: item.source_document_id,
        test_status: item.review_error ? "needs_review" : "draft",
        review_error: item.review_error,
        edited_by_vfda: false,
        missing_keys: [],
      })
      .eq("id", scenarioId)
      .neq("test_status", "live");
    if (error) return fail("Couldn't save. Try again.");
    // The old repeat no longer fits.
    await db.from("office_scenarios").delete().eq("parent_scenario_id", scenarioId);
    if (!item.review_error && item.type === "situational") after(() => addRepeat(scenarioId));
    return item.review_error ? fail(`Still needs review: ${item.review_error}`) : { ok: true, data: null };
  } catch (e) {
    return fail(`Couldn't regenerate: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await logCheckFailures(db, row.office_id, row.schedule_day, failures);
  }
}

// "Remove": the item (and its repeat) leaves the day.
export async function removeScenario(scenarioId: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(scenarioId)) return fail("Invalid request.");
  const row = await reviewableItem(scenarioId);
  if (!row || row.is_repeat_variant) return fail("Scenario not found.");
  if (row.test_status === "live") return fail("This day is approved. Reopen it to make changes.");
  if (await dayHasAttempts(createAdminClient(), row.office_id, row.schedule_day)) return fail("A VA has already started this day.");
  const supabase = await createSessionClient();
  const { error } = await supabase.from("office_scenarios").delete().eq("id", scenarioId).neq("test_status", "live");
  return error ? fail("Couldn't remove. Try again.") : { ok: true, data: null };
}


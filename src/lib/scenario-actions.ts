"use server";

// VFDA's scenario review (/admin/offices/[id]/scenarios): build or rebuild a
// day, edit a scenario, approve a day (sets it live for VAs) or reopen it.
// VFDA admins only. Building runs after the response is sent.

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { checkMc, correctResponseFromText, placeholdersIn } from "@/lib/scenario-build";
import { buildOfficeDay, claimBuild, dayHasAttempts, loadOfficeBuild } from "@/lib/scenario-builder";
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
      .select("version, type, options, missing_keys, is_repeat_variant")
      .eq("office_id", officeId)
      .eq("schedule_day", day),
  ]);
  if (status?.build_status !== "done") return fail("Build the day first.");
  const rows = scenarios ?? [];
  if (!rows.some((r) => r.version === "A" && !r.is_repeat_variant)) return fail("This day has no scenarios.");
  if (!rows.some((r) => r.version === "B" && !r.is_repeat_variant)) return fail("This day has no version B for retakes.");
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
    .select("office_id, schedule_day, type, correct_response, test_status, is_repeat_variant")
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
  const { error } = await supabase.from("office_scenarios").update(update).eq("id", scenarioId).neq("test_status", "live");
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}


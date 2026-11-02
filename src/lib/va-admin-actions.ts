"use server";

// VFDA's side of VA training (/admin/vas): accept proof of work or ask for a
// redo, decide a day that went to review, and set a VA's training start date.
// VFDA admins only; writes as the admin (row-level security applies).

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { recalculateAttempt } from "@/lib/attempt-review";
import { sendAttemptReport, sendTestEmail, sendTestSlack } from "@/lib/reports";
import { createSessionClient } from "@/lib/supabase/server";
import { nextTrainingDay } from "@/lib/va-training";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_CODE = /^W\dD\d$/;
const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

export async function reviewProof(proofId: string, decision: "accept" | "redo", note: string): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(proofId) || (decision !== "accept" && decision !== "redo")) return fail("Invalid request.");
  const text = note.trim().slice(0, 1000);
  if (decision === "redo" && !text) return fail("Say what to redo.");
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("proof_uploads")
    .update({
      status: decision === "accept" ? "accepted" : "redo",
      review_note: text || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", proofId)
    .select("id");
  if (error || !data?.length) return fail("Couldn't save. Try again.");
  return { ok: true, data: null };
}

// A day in review: approve it (counts as passed) or assign the retake
// (version B, from the next training day). A version B in review can only be
// approved; anything else is settled on a call.
export async function decideReviewDay(vaId: string, day: string, decision: "pass" | "retake"): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(vaId) || !DAY_CODE.test(day)) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const { data: unlock } = await supabase
    .from("day_unlocks")
    .select("version, status")
    .eq("va_id", vaId)
    .eq("schedule_day", day)
    .maybeSingle();
  if (unlock?.status !== "in_review") return fail("This day isn't waiting for review.");
  if (decision === "retake" && unlock.version === "B") return fail("Version B was already the retake. Approve it or talk it over with the VA.");
  const { error } = await supabase
    .from("day_unlocks")
    .update(
      decision === "pass"
        ? { status: "passed" }
        : { status: "retake", version: "B", opens_on: nextTrainingDay(), unlocked_at: null },
    )
    .eq("va_id", vaId)
    .eq("schedule_day", day)
    .eq("status", "in_review");
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

export async function setStartDate(vaId: string, date: string): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(vaId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return fail("Pick a date.");
  }
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ va_start_date: date })
    .eq("id", vaId)
    .eq("role", "va")
    .select("id");
  return error || !data?.length ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

// Sends whatever part of an attempt's report hasn't gone out (failed or never sent).
export async function resendAttemptReport(attemptId: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(attemptId)) return fail("Invalid request.");
  const { failed } = await sendAttemptReport(attemptId);
  return failed ? fail(`${failed} couldn't be sent. See the error beside the report.`) : { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Attempt review (/admin/attempts/[id])
// ---------------------------------------------------------------------------

export type OverrideInput = { firstScore: number; repeatScore: number | null; criticalError: boolean; note: string };

// VFDA changes an item's score (with a note); the day result is worked out again.
export async function overrideScore(itemId: string, input: OverrideInput): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(itemId)) return fail("Invalid request.");
  const note = String(input.note ?? "").trim().slice(0, 1000);
  if (!note) return fail("Add a note saying why.");
  const supabase = await createSessionClient();
  const { data: item } = await supabase
    .from("attempt_items")
    .select("attempt_id, office_scenario_id, repeat_scenario_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return fail("Item not found.");
  const { data: scenario } = await supabase.from("office_scenarios").select("type, points").eq("id", item.office_scenario_id).single();
  const max = scenario?.type === "mc" ? scenario.points : 2;
  const valid = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
  if (!valid(input.firstScore)) return fail(`The first-try score must be 0 to ${max}.`);
  if (item.repeat_scenario_id ? !valid(input.repeatScore) : input.repeatScore !== null) return fail("Invalid repeat score.");

  const override = {
    first_score: input.firstScore,
    repeat_score: item.repeat_scenario_id ? input.repeatScore : null,
    critical_error: !!input.criticalError,
    note,
    by: user.fullName || user.email,
    at: new Date().toISOString(),
  };
  const { error } = await supabase.from("attempt_items").update({ vfda_override: override }).eq("id", itemId);
  if (error) return fail("Couldn't save. Try again.");
  try {
    await recalculateAttempt(supabase, item.attempt_id);
  } catch {
    return fail("Saved, but the day result couldn't be worked out again. Reload the page.");
  }
  return { ok: true, data: null };
}

// "Approve unlock": the day counts as passed and the next one can open (also
// cancels a retake that hasn't started). "Assign retake": version B opens the
// next training day.
export async function decideAttempt(attemptId: string, decision: "pass" | "retake"): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(attemptId) || (decision !== "pass" && decision !== "retake")) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const { data: attempt } = await supabase
    .from("attempts")
    .select("va_id, schedule_day, version, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt?.submitted_at) return fail("This attempt isn't finished.");
  const [{ data: unlock }, { data: versionB }] = await Promise.all([
    supabase.from("day_unlocks").select("status").eq("va_id", attempt.va_id).eq("schedule_day", attempt.schedule_day).maybeSingle(),
    supabase.from("attempts").select("id").eq("va_id", attempt.va_id).eq("schedule_day", attempt.schedule_day).eq("version", "B").maybeSingle(),
  ]);
  if (attempt.version === "A" && versionB) return fail("Version B was already started; decide that attempt instead.");
  const status = unlock?.status;

  if (decision === "pass") {
    if (status !== "in_review" && status !== "retake") return fail("This day isn't waiting for a decision.");
    const { data, error } = await supabase
      .from("day_unlocks")
      .update({ status: "passed", version: attempt.version, opens_on: null })
      .eq("va_id", attempt.va_id)
      .eq("schedule_day", attempt.schedule_day)
      .eq("status", status)
      .select("status");
    return error || !data?.length ? fail("Couldn't save. Try again.") : { ok: true, data: null };
  }
  if (attempt.version === "B") return fail("Version B was already the retake. Approve it or talk it over with the VA.");
  if (status !== "in_review") return fail("This day isn't waiting for a decision.");
  const { data, error } = await supabase
    .from("day_unlocks")
    .update({ status: "retake", version: "B", opens_on: nextTrainingDay(), unlocked_at: null })
    .eq("va_id", attempt.va_id)
    .eq("schedule_day", attempt.schedule_day)
    .eq("status", status)
    .select("status");
  return error || !data?.length ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Test buttons (/admin/settings)
// ---------------------------------------------------------------------------

export async function testEmail(): Promise<ActionResult<string>> {
  if (!(await admin())) return fail("VFDA admins only.");
  const { sentTo, error } = await sendTestEmail();
  return error ? fail(error) : { ok: true, data: `Sent to ${sentTo.join(", ")}.` };
}

export async function testSlack(): Promise<ActionResult<string>> {
  if (!(await admin())) return fail("VFDA admins only.");
  const error = await sendTestSlack();
  return error ? fail(error) : { ok: true, data: "Posted to Slack." };
}

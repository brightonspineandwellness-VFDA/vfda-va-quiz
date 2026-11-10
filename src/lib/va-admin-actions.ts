"use server";

// VFDA's side of VA training (/admin/vas): accept proof of work or ask for a
// redo, set a VA's training start date (reports only: days since start),
// override a score (which changes only the label), and "Reset day (test)".
// Nothing here blocks or unlocks a day.
// VFDA admins only; writes as the admin (row-level security applies).

import { after } from "next/server";
import { recalculateAttempt } from "@/lib/attempt-review";
import { getCurrentUser } from "@/lib/auth";
import { recalculateCertifications } from "@/lib/certifications";
import type { ActionResult } from "@/lib/interview-actions";
import { refreshQuizReport } from "@/lib/quiz-report-download";
import { sendAttemptReport, sendSopNotice, sendTestEmail, sendTestLeads4Life, sendTestSlack } from "@/lib/reports";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

const DAY_CODE = /^W\dD\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

// VFDA changes an item's score (with a note); the day's label is worked out again.
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
    const { data: owner } = await supabase.from("attempts").select("va_id").eq("id", item.attempt_id).single();
    if (owner) await recalculateCertifications(owner.va_id);
    // The quiz report PDF is made again at the same path, so the link
    // already sent to the doctor shows the new scores.
    after(() => refreshQuizReport(item.attempt_id).catch((e) => console.error("Quiz report PDF not made again", e)));
  } catch {
    return fail("Saved, but the label couldn't be worked out again. Reload the page.");
  }
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Test buttons (/admin/settings)
// ---------------------------------------------------------------------------

export async function testEmail(): Promise<ActionResult<string>> {
  if (!(await admin())) return fail("VFDA admins only.");
  const { sentTo, error } = await sendTestEmail();
  return error ? fail(error) : { ok: true, data: `Sent to ${sentTo.join(", ")}.` };
}

// Shows Leads4Life's answer: its status code (and the start of its reply).
export async function testLeads4Life(): Promise<ActionResult<string>> {
  if (!(await admin())) return fail("VFDA admins only.");
  const r = await sendTestLeads4Life();
  if (r.error) return fail(r.error);
  return r.status !== null && r.status >= 200 && r.status < 300 ? { ok: true, data: `Leads4Life answered ${r.text}` } : fail(`Leads4Life answered ${r.text}`);
}

export async function testSlack(): Promise<ActionResult<string>> {
  if (!(await admin())) return fail("VFDA admins only.");
  const error = await sendTestSlack();
  return error ? fail(error) : { ok: true, data: "Posted to Slack." };
}

// ---------------------------------------------------------------------------
// SOPs on Trello (/admin/sops) and certifications
// ---------------------------------------------------------------------------

// VFDA saw on Trello that the doctor approved the card (or not).
export async function confirmSop(
  certificationId: string,
  decision: "approved" | "needs_changes" | "rejected",
  note: string,
): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(certificationId) || !["approved", "needs_changes", "rejected"].includes(decision)) return fail("Invalid request.");
  const text = String(note ?? "").trim().slice(0, 2000);
  if (decision !== "approved" && !text) return fail("Add a note for the VA.");
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("certifications")
    .update({
      sop_status: decision,
      sop_note: text || null,
      sop_confirmed_by: user.id,
      sop_confirmed_at: new Date().toISOString(),
    })
    .eq("id", certificationId)
    .not("sop_submitted_at", "is", null)
    .select("va_id");
  if (error || !data?.length) return fail("Couldn't save. Try again.");
  await recalculateCertifications(data[0].va_id);
  after(() => sendSopNotice(certificationId, decision).then(() => undefined));
  return { ok: true, data: null };
}

// "Reset day (test)": archives the VA's attempt at one day and its retake
// (kept, marked archived, with who and when; no longer counted in scores or reports) and
// opens the day again, so the VA takes it on the live version. Logged to the
// System log.
export async function resetDay(vaId: string, day: string): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(vaId) || !DAY_CODE.test(day)) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const { data: va } = await supabase.from("profiles").select("full_name, email, office_id").eq("id", vaId).eq("role", "va").maybeSingle();
  if (!va?.office_id) return fail("VA not found.");
  const now = new Date().toISOString();
  const { data: archived, error } = await supabase
    .from("attempts")
    .update({ archived_at: now, archived_by: user.id })
    .eq("va_id", vaId)
    .eq("office_id", va.office_id)
    .eq("schedule_day", day)
    .in("kind", ["day", "retake"])
    .is("archived_at", null)
    .select("id, kind, build_version, submitted_at");
  if (error) return fail("Couldn't reset. Try again.");
  if (!archived?.length) return fail(`${va.full_name || va.email} has no attempt at ${day} to reset.`);
  await supabase
    .from("day_unlocks")
    .update({ status: "open", unlocked_at: now })
    .eq("va_id", vaId)
    .eq("office_id", va.office_id)
    .eq("schedule_day", day);
  const a = archived.find((x) => x.kind === "day") ?? archived[0];
  const { error: logError } = await createAdminClient()
    .from("system_logs")
    .insert({
      kind: "day_reset",
      office_id: va.office_id,
      schedule_day: day,
      item: (va.full_name || va.email).slice(0, 200),
      field: "attempt",
      value: `${a.id} (version ${a.build_version ?? 1}, ${a.submitted_at ? "finished" : "in progress"})`,
      reason: `Reset day (test) by ${user.email} at ${now}: attempt archived; the VA takes the day again on the live version.`,
    });
  if (logError) console.error("System log not written", logError.message);
  after(async () => {
    try {
      await recalculateCertifications(vaId);
    } catch (e) {
      console.error("Certifications not recalculated after a reset", vaId, e);
    }
  });
  return { ok: true, data: null };
}

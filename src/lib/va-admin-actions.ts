"use server";

// VFDA's side of VA training (/admin/vas): accept proof of work or ask for a
// redo, set a VA's training start date, and override a score (which changes
// only the label). Nothing here blocks or unlocks a day.
// VFDA admins only; writes as the admin (row-level security applies).

import { after } from "next/server";
import { recalculateAttempt } from "@/lib/attempt-review";
import { getCurrentUser } from "@/lib/auth";
import { recalculateCertifications } from "@/lib/certifications";
import type { ActionResult } from "@/lib/interview-actions";
import { sendAttemptReport, sendSopNotice, sendTestEmail, sendTestSlack } from "@/lib/reports";
import { createSessionClient } from "@/lib/supabase/server";

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

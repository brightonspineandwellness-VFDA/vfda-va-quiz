"use server";

// VFDA's side of VA training (/admin/vas): accept proof of work or ask for a
// redo, decide a day that went to review, and set a VA's training start date.
// VFDA admins only; writes as the admin (row-level security applies).

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
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

"use server";

// VFDA's review of extracted rules (/admin/offices/[id]/rules) and "Send to
// doctor", which writes the gap questions and opens steps 4-6 for the doctor.
// VFDA admins only; writes as the admin (row-level security applies).

import { getCurrentUser } from "@/lib/auth";
import { checkAnswerValue, type InterviewQuestion } from "@/lib/interview";
import type { ActionResult } from "@/lib/interview-actions";
import { loadOfficeSetup } from "@/lib/interview-data";
import { createSessionClient } from "@/lib/supabase/server";

const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

// Accept (the doctor confirms it next) or reject one extracted rule.
export async function reviewRule(ruleId: string, decision: "accept" | "reject"): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  const supabase = await createSessionClient();
  const { error } = await supabase
    .from("office_rules")
    .update({
      status: decision === "accept" ? "needs_doctor" : "rejected",
      vfda_reviewed_by: user.id,
      vfda_reviewed_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .eq("source", "card_import");
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

// Fix an extracted rule's wording, then accept it.
export async function editAndAcceptRule(ruleId: string, value: unknown): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  const supabase = await createSessionClient();
  const { data: row } = await supabase
    .from("office_rules")
    .select("rule_slot_key")
    .eq("id", ruleId)
    .eq("source", "card_import")
    .maybeSingle();
  const { data: slot } = row
    ? await supabase.from("rule_slots").select("key, answer_type").eq("key", row.rule_slot_key).maybeSingle()
    : { data: null };
  if (!slot) return fail("That rule is gone.");
  const problem = checkAnswerValue(slot as InterviewQuestion, value);
  if (problem) return fail(problem);
  const { error } = await supabase
    .from("office_rules")
    .update({ rule: value, status: "needs_doctor", vfda_reviewed_by: user.id, vfda_reviewed_at: new Date().toISOString() })
    .eq("id", ruleId);
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

// Drop an edge-case question before the doctor sees it.
export async function removeEdgeCase(gapId: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  const supabase = await createSessionClient();
  const { error } = await supabase
    .from("gap_questions")
    .delete()
    .eq("id", gapId)
    .eq("reason", "edge_case")
    .is("answered_at", null);
  return error ? fail("Couldn't remove it. Try again.") : { ok: true, data: null };
}

// Writes the gap list (only slots still missing; never re-asks an answered
// one), releases it to the doctor, and opens steps 4-6.
export async function sendToDoctor(officeId: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  const setup = await loadOfficeSetup(officeId);
  if (!setup) return fail("Office not found.");
  if (!setup.state.cardsUploadedAt) return fail("No cards uploaded yet.");
  if (setup.state.extractionStatus !== "done") return fail("Wait until the cards have been read.");
  if (setup.flow.awaitingReview) return fail("Accept or reject every extracted rule first.");

  const supabase = await createSessionClient();
  const now = new Date().toISOString();
  const { add, update, remove } = setup.gapPlan;
  if (remove.length) {
    const { error } = await supabase.from("gap_questions").delete().in("id", remove).is("answered_at", null);
    if (error) return fail("Couldn't update the questions. Try again.");
  }
  for (const u of update) {
    const { error } = await supabase.from("gap_questions").update({ reason: u.reason }).eq("id", u.id);
    if (error) return fail("Couldn't update the questions. Try again.");
  }
  if (add.length) {
    const { error } = await supabase
      .from("gap_questions")
      .insert(add.map((g) => ({ ...g, office_id: officeId, released_at: now })));
    if (error) return fail("Couldn't write the questions. Try again.");
  }
  const { error: releaseError } = await supabase
    .from("gap_questions")
    .update({ released_at: now })
    .eq("office_id", officeId)
    .is("released_at", null);
  if (releaseError) return fail("Couldn't send the questions. Try again.");

  const { error } = await supabase
    .from("offices")
    .update({ sent_to_doctor_at: setup.state.sentToDoctorAt ?? now })
    .eq("id", officeId);
  if (error) return fail("Couldn't save. Try again.");
  await supabase.from("offices").update({ status: "gap_list" }).eq("id", officeId).in("status", ["setup", "rules_in_review"]);
  return { ok: true, data: null };
}

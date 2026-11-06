"use server";

// VFDA's review of rules read from the cards (/admin/offices/[id]/rules) and
// "Send to doctor", which writes the must-ask questions and opens steps 4-5
// for the doctor. Once the review is finished (and again after a re-import),
// the office SOP gap report is written for VFDA, after the response.
// VFDA admins only; writes as the admin (row-level security applies).

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkAnswerValue, type InterviewQuestion } from "@/lib/interview";
import type { ActionResult } from "@/lib/interview-actions";
import { loadOfficeSetup } from "@/lib/interview-data";
import { reportIfDue } from "@/lib/office-reports";
import { createSessionClient } from "@/lib/supabase/server";

const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

// The gap report, if this finished the review (never fails the action).
const reportLater = (officeId: string, by: string) =>
  after(async () => {
    try {
      await reportIfDue(officeId, by);
    } catch (e) {
      console.error("Office SOP gap report not written", officeId, e);
    }
  });

// Accept or reject one rule read from a card. Accepted card rules are the
// office's rules; the doctor isn't asked to confirm them.
export async function reviewRule(ruleId: string, decision: "accept" | "reject"): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  const supabase = await createSessionClient();
  const { data: saved, error } = await supabase
    .from("office_rules")
    .update({
      status: decision === "accept" ? "accepted" : "rejected",
      vfda_reviewed_by: user.id,
      vfda_reviewed_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .eq("source", "card_import")
    .select("office_id");
  if (error) return fail("Couldn't save. Try again.");
  if (saved?.[0]) reportLater(saved[0].office_id, user.id);
  return { ok: true, data: null };
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
  const { data: saved, error } = await supabase
    .from("office_rules")
    .update({ rule: value, status: "accepted", vfda_reviewed_by: user.id, vfda_reviewed_at: new Date().toISOString() })
    .eq("id", ruleId)
    .select("office_id");
  if (error) return fail("Couldn't save. Try again.");
  if (saved?.[0]) reportLater(saved[0].office_id, user.id);
  return { ok: true, data: null };
}

// Writes the must-ask questions (only rules still missing; never re-asks an
// answered one), releases them to the doctor, and opens steps 4-5.
export async function sendToDoctor(officeId: string): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
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
  reportLater(officeId, user.id);
  return { ok: true, data: null };
}

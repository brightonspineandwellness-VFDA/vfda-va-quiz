"use server";

// The doctor's answers in steps 4-5. Each action re-reads the office's flow
// on the server, refuses while those steps are locked (until VFDA sends the
// reviewed rules), and only touches what the flow shows. Answers are written
// as the doctor (row-level security and the database guards apply).

import { getCurrentUser } from "@/lib/auth";
import { checkAnswerValue } from "@/lib/interview";
import type { ActionResult } from "@/lib/interview-actions";
import { loadOfficeSetup } from "@/lib/interview-data";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

const fail = (error: string) => ({ ok: false, error }) as const;
const LOCKED = "This step opens after VFDA reviews your cards.";

// The signed-in doctor's office flow.
async function doctorFlow() {
  const user = await getCurrentUser();
  if (user?.role !== "doctor" || !user.officeId) return null;
  const setup = await loadOfficeSetup(user.officeId);
  return setup ? { officeId: user.officeId, flow: setup.flow } : null;
}

// Step 5: "Anything your cards don't cover uses VFDA standards." Doctors
// can't write offices, so this one checkbox is saved with the service role
// after the checks above.
export async function setStandardsAccepted(accepted: boolean): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can accept the standards.");
  if (!ctx.flow.unlocked) return fail(LOCKED);
  const user = await getCurrentUser();
  const { error } = await createAdminClient()
    .from("offices")
    .update(
      accepted
        ? { standards_accepted_at: new Date().toISOString(), standards_accepted_by: user!.id }
        : { standards_accepted_at: null, standards_accepted_by: null },
    )
    .eq("id", ctx.officeId);
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

// "Questions for you": the doctor's answer to one gap question. For a rule
// slot it also becomes the office's accepted rule (source doctor).
export async function answerGapQuestion(gapId: string, value: unknown): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can answer.");
  if (!ctx.flow.unlocked) return fail(LOCKED);
  const item = ctx.flow.questions.find((q) => q.gap.id === gapId);
  if (!item) return fail("That question isn't open any more.");
  const supabase = await createSessionClient();

  if (item.slot) {
    const problem = checkAnswerValue(item.slot, value);
    if (problem) return fail(problem);
    const { error } = await supabase.from("office_rules").upsert(
      {
        office_id: ctx.officeId,
        rule_slot_key: item.slot.key,
        source_document_id: null,
        rule: value,
        source: "doctor",
        status: "accepted",
      },
      { onConflict: "office_id,rule_slot_key,source_document_id" },
    );
    if (error) return fail("Couldn't save. Try again.");
  } else if (typeof value !== "string" || !value.trim()) {
    return fail("Type your answer first.");
  } else if (value.length > 5000) {
    return fail("That answer is too long.");
  }

  // The guard stamps who answered and when.
  const { error } = await supabase.from("gap_questions").update({ answer: value }).eq("id", gapId);
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

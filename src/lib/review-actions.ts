"use server";

// VFDA's rules page (/admin/offices/[id]/rules) is read-only: rules read from
// the cards apply at once. "Correct" fixes one the reading got wrong.
// VFDA admins only; writes as the admin (row-level security applies).

import { getCurrentUser } from "@/lib/auth";
import { checkAnswerValue, type InterviewQuestion } from "@/lib/interview";
import type { ActionResult } from "@/lib/interview-actions";
import { createSessionClient } from "@/lib/supabase/server";

const fail = (error: string) => ({ ok: false, error }) as const;

// Corrects a rule read from a card (or from the doctor's VA Office Rules card).
export async function correctRule(ruleId: string, value: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return fail("VFDA admins only.");
  const supabase = await createSessionClient();
  const { data: row } = await supabase
    .from("office_rules")
    .select("rule_slot_key")
    .eq("id", ruleId)
    .in("source", ["card_import", "doctor_card"])
    .maybeSingle();
  const { data: slot } = row
    ? await supabase.from("rule_slots").select("key, answer_type").eq("key", row.rule_slot_key).maybeSingle()
    : { data: null };
  if (!slot) return fail("That rule is gone.");
  const problem = checkAnswerValue(slot as InterviewQuestion, value);
  if (problem) return fail(problem);
  const { error } = await supabase
    .from("office_rules")
    .update({ rule: value, status: "accepted", vfda_reviewed_by: user.id, vfda_reviewed_at: new Date().toISOString() })
    .eq("id", ruleId);
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

"use server";

// Step 3 of the doctor's setup: "Anything your cards don't cover uses VFDA
// standards". The doctor is never asked about rules.

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { loadOfficeSetup } from "@/lib/interview-data";
import { createAdminClient } from "@/lib/supabase/server";

const fail = (error: string) => ({ ok: false, error }) as const;

// The signed-in doctor's office flow.
async function doctorFlow() {
  const user = await getCurrentUser();
  if (user?.role !== "doctor" || !user.officeId) return null;
  const setup = await loadOfficeSetup(user.officeId);
  return setup ? { officeId: user.officeId, flow: setup.flow } : null;
}

// "Anything your cards don't cover uses VFDA standards." Doctors
// can't write offices, so this one checkbox is saved with the service role
// after the checks above.
export async function setStandardsAccepted(accepted: boolean): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only a doctor of this office can accept the standards.");
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

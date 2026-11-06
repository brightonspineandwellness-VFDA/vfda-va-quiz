"use server";

// The office SOP gap report page's buttons (VFDA admins only): write a new
// report now, and send one again where the email or Slack post failed.

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { generateOfficeReport, sendOfficeReport } from "@/lib/office-reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

export async function regenerateOfficeReport(officeId: string): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(officeId)) return fail("Invalid request.");
  try {
    const id = await generateOfficeReport(officeId, "manual", user.id);
    return id ? { ok: true, data: null } : fail("Office not found.");
  } catch (e) {
    console.error("Office SOP gap report not written", officeId, e);
    return fail(`Couldn't write the report: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
}

export async function resendOfficeReport(reportId: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(reportId)) return fail("Invalid request.");
  const { emailError, slackError } = await sendOfficeReport(reportId);
  const errors = [emailError && `Email: ${emailError}`, slackError && `Slack: ${slackError}`].filter(Boolean);
  return errors.length ? fail(errors.join(" · ")) : { ok: true, data: null };
}

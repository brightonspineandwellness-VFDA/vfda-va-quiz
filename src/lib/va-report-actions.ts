"use server";

// VFDA's side of VA reports: edit the text a VA sees (shows on My report at
// once, no new email), and "Backfill VA reports" (/admin/settings).

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { createSessionClient } from "@/lib/supabase/server";
import { linesOf, MAX_TIPS } from "@/lib/va-report";
import { backfillVaReports } from "@/lib/va-reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;

// One line per bullet in each box.
export async function saveVaReport(attemptId: string, text: { alerts: string; tips: string; strengths: string }): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return fail("VFDA admins only.");
  if (!UUID.test(attemptId)) return fail("Invalid request.");
  const tips = linesOf(text.tips, MAX_TIPS);
  const strengths = linesOf(text.strengths, 2);
  if (!tips.length && !strengths.length) return fail("Write at least one coaching tip or one thing they did well.");
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("va_reports")
    .update({ alerts: linesOf(text.alerts, 10), tips, strengths, edited_at: new Date().toISOString(), edited_by: user.id })
    .eq("attempt_id", attemptId)
    .select("attempt_id");
  if (error || !data?.length) return fail("Couldn't save. Try again.");
  revalidatePath(`/admin/attempts/${attemptId}`);
  return { ok: true, data: null };
}

export async function runVaReportBackfill(): Promise<ActionResult<string>> {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return fail("VFDA admins only.");
  try {
    const r = await backfillVaReports();
    const parts = [
      `${r.created} report${r.created === 1 ? "" : "s"} created`,
      `${r.emailsSent} email${r.emailsSent === 1 ? "" : "s"} sent`,
      r.alreadyThere ? `${r.alreadyThere} already had one` : null,
      r.skippedMock ? `${r.skippedMock} skipped (mock grades, see System log)` : null,
      r.skippedDeactivated ? `${r.skippedDeactivated} skipped (deactivated VA)` : null,
      r.emailsFailed ? `${r.emailsFailed} email${r.emailsFailed === 1 ? "" : "s"} failed (run again to retry)` : null,
      r.failed.length ? `${r.failed.length} failed: ${r.failed.map((f) => `${f.attempt} (${f.error})`).join("; ")}` : null,
    ].filter(Boolean);
    const text = `${parts.join(", ")}.`;
    return r.failed.length || r.emailsFailed ? fail(text) : { ok: true, data: text };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

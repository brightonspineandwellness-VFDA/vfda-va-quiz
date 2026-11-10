import "server-only";

// "Download report PDF" (the admin attempt page, the doctor's attempt page
// and My VA): the attempt's stored quiz report PDF, made now if it wasn't yet.
// VFDA, or a doctor of the attempt's office; never a VA.

import type { CurrentUser } from "@/lib/auth";
import { reportFileName } from "@/lib/quiz-report";
import { ensureQuizReport } from "@/lib/quiz-reports";
import { loadAttemptReport } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function quizReportDownload(user: CurrentUser | null, attemptId: string): Promise<Response> {
  if (user?.role !== "vfda_admin" && user?.role !== "doctor") return new Response("Not allowed.", { status: 403 });
  if (!UUID.test(attemptId)) return new Response("Not found.", { status: 404 });
  const db = createAdminClient();
  const { data: attempt } = await db.from("attempts").select("office_id").eq("id", attemptId).maybeSingle();
  if (!attempt) return new Response("Not found.", { status: 404 });
  if (user.role === "doctor" && attempt.office_id !== user.officeId) return new Response("Not allowed.", { status: 403 });
  const loaded = await loadAttemptReport(db, attemptId);
  // Not finished yet.
  if (!loaded) return new Response("Not found.", { status: 404 });
  const { bytes } = await ensureQuizReport(db, attemptId, loaded.report);
  const name = reportFileName({ ...loaded.report, retake: !!loaded.report.retake }).replace(/[^\w .()-]+/g, "");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// After VFDA changed a score: the PDF again, with the new scores and tips.
export async function refreshQuizReport(attemptId: string) {
  const db = createAdminClient();
  const loaded = await loadAttemptReport(db, attemptId);
  if (loaded) await ensureQuizReport(db, attemptId, loaded.report, true);
}

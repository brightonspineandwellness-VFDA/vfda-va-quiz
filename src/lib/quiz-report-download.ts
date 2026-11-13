import "server-only";

// "Download report PDF" (the admin attempt page, the doctor's attempt page
// and My VA): the quiz report PDF, made now from the current data (replacing
// the stored copy and its link).
// VFDA, or a doctor of the attempt's office; never a VA.

import type { CurrentUser } from "@/lib/auth";
import { reportFileName } from "@/lib/quiz-report";
import { makeQuizReport } from "@/lib/quiz-reports";
import { loadAttemptReport } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { vaReportFileName, vaReportPdf } from "@/lib/va-report-pdf";
import { loadVaReportView } from "@/lib/va-reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// VFDA, or a doctor of the attempt's office. Null when allowed.
async function denied(user: CurrentUser | null, attemptId: string): Promise<Response | null> {
  if (user?.role !== "vfda_admin" && user?.role !== "doctor") return new Response("Not allowed.", { status: 403 });
  if (!UUID.test(attemptId)) return new Response("Not found.", { status: 404 });
  const { data: attempt } = await createAdminClient().from("attempts").select("office_id").eq("id", attemptId).maybeSingle();
  if (!attempt) return new Response("Not found.", { status: 404 });
  if (user.role === "doctor" && attempt.office_id !== user.officeId) return new Response("Not allowed.", { status: 403 });
  return null;
}

const pdfResponse = (bytes: Uint8Array, name: string, inline: boolean) =>
  new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // inline: opens in the browser tab ("Doctor report", "VA report"); else a download.
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\w .()-]+/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });

// `inline`: open it in the browser instead of downloading (?view=1).
export async function quizReportDownload(user: CurrentUser | null, attemptId: string, inline = false): Promise<Response> {
  const no = await denied(user, attemptId);
  if (no) return no;
  const db = createAdminClient();
  const loaded = await loadAttemptReport(db, attemptId);
  // Not finished yet.
  if (!loaded) return new Response("Not found.", { status: 404 });
  const { bytes } = await makeQuizReport(db, attemptId, loaded.report);
  return pdfResponse(bytes, reportFileName({ ...loaded.report, retake: !!loaded.report.retake }), inline);
}

// "VA report": the VA's My report as a PDF, exactly what the VA sees (VFDA, or a doctor of the office).
export async function vaReportDownload(user: CurrentUser | null, attemptId: string): Promise<Response> {
  const no = await denied(user, attemptId);
  if (no) return no;
  const view = await loadVaReportView(createAdminClient(), attemptId);
  if (!view) return new Response("Not found.", { status: 404 });
  return pdfResponse(await vaReportPdf(view), `${view.vaName} - ${vaReportFileName(view)}`, true);
}

// After VFDA changed a score: the PDF again, with the new scores and tips.
export async function refreshQuizReport(attemptId: string) {
  const db = createAdminClient();
  const loaded = await loadAttemptReport(db, attemptId);
  if (loaded) await makeQuizReport(db, attemptId, loaded.report);
}

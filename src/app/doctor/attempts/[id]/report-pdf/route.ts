import { getCurrentUser } from "@/lib/auth";
import { quizReportDownload } from "@/lib/quiz-report-download";

// The attempt's quiz report PDF (the office's doctors, own office only).
// Making it the first time asks Claude for the coaching tips.
export const maxDuration = 120;

export async function GET(request: Request, { params }: RouteContext<"/doctor/attempts/[id]/report-pdf">) {
  const user = await getCurrentUser();
  if (user?.role !== "doctor") return new Response("Not allowed.", { status: 403 });
  return quizReportDownload(user, (await params).id, new URL(request.url).searchParams.get("view") === "1");
}

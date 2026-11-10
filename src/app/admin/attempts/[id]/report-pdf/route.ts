import { getCurrentUser } from "@/lib/auth";
import { quizReportDownload } from "@/lib/quiz-report-download";

// The attempt's quiz report PDF (VFDA).
// Making it the first time asks Claude for the coaching tips.
export const maxDuration = 120;

export async function GET(_request: Request, { params }: RouteContext<"/admin/attempts/[id]/report-pdf">) {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return new Response("Not allowed.", { status: 403 });
  return quizReportDownload(user, (await params).id);
}

import { getCurrentUser } from "@/lib/auth";
import { vaReportDownload } from "@/lib/quiz-report-download";

// "VA report": the VA's My report as a PDF, opened in the browser (the office's doctors, own office only).
export async function GET(_request: Request, { params }: RouteContext<"/doctor/attempts/[id]/va-report-pdf">) {
  const user = await getCurrentUser();
  if (user?.role !== "doctor") return new Response("Not allowed.", { status: 403 });
  return vaReportDownload(user, (await params).id);
}

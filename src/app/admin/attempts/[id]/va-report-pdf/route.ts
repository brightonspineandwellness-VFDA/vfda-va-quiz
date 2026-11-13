import { getCurrentUser } from "@/lib/auth";
import { vaReportDownload } from "@/lib/quiz-report-download";

// "VA report": the VA's My report as a PDF, opened in the browser (VFDA).
export async function GET(_request: Request, { params }: RouteContext<"/admin/attempts/[id]/va-report-pdf">) {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return new Response("Not allowed.", { status: 403 });
  return vaReportDownload(user, (await params).id);
}

import { getCurrentUser } from "@/lib/auth";
import { trainingPdfDownload } from "@/lib/training-download";

// "[VA] – Training overview (4-week plan)" as a PDF.
export async function GET(_request: Request, { params }: RouteContext<"/admin/training/[vaId]/overview-pdf">) {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return new Response("Not allowed.", { status: 403 });
  return trainingPdfDownload(user, (await params).vaId, null);
}

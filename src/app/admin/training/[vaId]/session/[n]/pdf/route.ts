import { getCurrentUser } from "@/lib/auth";
import { trainingPdfDownload } from "@/lib/training-download";

// One session's Training Sheet as a PDF.
export async function GET(_request: Request, { params }: RouteContext<"/admin/training/[vaId]/session/[n]/pdf">) {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return new Response("Not allowed.", { status: 403 });
  const { vaId, n } = await params;
  const number = Number(n);
  if (!Number.isInteger(number) || number < 1 || number > 8) return new Response("Not found.", { status: 404 });
  return trainingPdfDownload(user, vaId, number);
}

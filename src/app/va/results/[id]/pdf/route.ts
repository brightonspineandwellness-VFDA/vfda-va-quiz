import { getCurrentUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";
import { vaReportFileName, vaReportPdf } from "@/lib/va-report-pdf";
import { loadMyVaReport } from "@/lib/va-reports";

// My report as a PDF: the signed-in VA's own report, same content as the page.
export async function GET(_request: Request, { params }: RouteContext<"/va/results/[id]/pdf">) {
  const user = await getCurrentUser();
  if (user?.role !== "va") return new Response("Not allowed.", { status: 403 });
  const view = await loadMyVaReport(user, (await params).id, await createSessionClient());
  if (!view) return new Response("Not found.", { status: 404 });
  return new Response(Buffer.from(await vaReportPdf(view)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${vaReportFileName(view)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

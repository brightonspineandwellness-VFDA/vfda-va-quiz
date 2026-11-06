import { getCurrentUser } from "@/lib/auth";
import type { OfficeReportContent } from "@/lib/office-report";
import { officeReportPdf } from "@/lib/office-report-pdf";
import { createSessionClient } from "@/lib/supabase/server";

// "Download PDF": one office SOP gap report (?r=<id>, else the latest), for
// VFDA admins only. Read with the admin's session (row-level security: VFDA only).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return new Response("VFDA admins only.", { status: 403 });
  const { id } = await params;
  const reportId = new URL(request.url).searchParams.get("r");
  if (!UUID.test(id) || (reportId && !UUID.test(reportId))) return new Response("Not found.", { status: 404 });
  const supabase = await createSessionClient();
  let query = supabase.from("office_reports").select("id, content, created_at").eq("office_id", id);
  query = reportId ? query.eq("id", reportId) : query.order("created_at", { ascending: false }).limit(1);
  const { data } = await query;
  const row = data?.[0] as { content: OfficeReportContent; created_at: string } | undefined;
  if (!row) return new Response("No report yet.", { status: 404 });
  const pdf = await officeReportPdf(row.content);
  const name = `SOP gap report - ${row.content.officeName.replace(/[^\w .-]+/g, "")} - ${row.created_at.slice(0, 10)}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

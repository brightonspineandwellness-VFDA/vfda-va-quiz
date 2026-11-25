import { getCurrentUser } from "@/lib/auth";
import { callReportPdf } from "@/lib/call-practice/report-pdf";
import { REPORT_COLUMNS, type CallReportRow } from "@/lib/call-practice/report";
import { createAdminClient } from "@/lib/supabase/server";

// A Call practice report as a PDF. The VA gets their own (without the
// doctor's coaching ideas); a doctor gets their office's; VFDA gets any.
export async function GET(_request: Request, ctx: RouteContext<"/api/calls/reports/[id]/pdf">) {
  const user = await getCurrentUser();
  if (!user?.role) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const { data } = await createAdminClient().from("call_reports").select(REPORT_COLUMNS).eq("id", id).maybeSingle();
  const r = data as CallReportRow | null;
  const allowed =
    !!r &&
    (user.role === "vfda_admin" ||
      (user.role === "doctor" && user.officeId === r.office_id) ||
      (user.role === "va" && user.id === r.va_id));
  if (!r || !allowed) return Response.json({ error: "Not found." }, { status: 404 });
  const bytes = await callReportPdf(r.content, user.role === "va" ? "va" : "staff");
  const name = `Call practice report - ${r.content.vaName} - calls ${r.content.firstCall}-${r.content.lastCall}.pdf`.replace(/[^\w .()-]/g, "");
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}

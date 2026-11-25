import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallReportView } from "@/components/calls/call-report";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { REPORT_COLUMNS, reportTitle, type CallReportRow } from "@/lib/call-practice/report";
import { createAdminClient } from "@/lib/supabase/server";
import { zoneOf } from "@/lib/week";

export default function CallReportPage({ params }: PageProps<"/doctor/calls/reports/[id]">) {
  return (
    <SignedInPage area="Doctor">
      <Suspense fallback={<Loading />}>
        <Report params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Report({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("doctor");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  void user;
  const db = createAdminClient();
  const { data } = await db.from("call_reports").select(REPORT_COLUMNS).eq("id", id).eq("office_id", user.officeId ?? "").maybeSingle();
  const r = data as CallReportRow | null;
  if (!r) notFound();
  const office = await db.from("offices").select("time_zone").eq("id", r.office_id).maybeSingle();
  return (
    <>
      <PageHeader
        title={reportTitle(r.content)}
        breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "Call practice", href: "/doctor/calls" }, { label: "Report" }]}
      />
      <CallReportView id={r.id} r={r.content} timeZone={zoneOf((office.data as { time_zone: string | null } | null)?.time_zone)} audience="staff" />
    </>
  );
}

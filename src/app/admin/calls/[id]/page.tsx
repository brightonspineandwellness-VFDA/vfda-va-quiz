import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallFeedbackView, FEEDBACK_COLUMNS, type FeedbackCall } from "@/components/calls/call-feedback";
import { OverrideCall } from "@/components/calls/override-call";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { zoneOf } from "@/lib/week";

export default function AdminCallPage({ params }: PageProps<"/admin/calls/[id]">) {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="Practice call"
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Call practice", href: "/admin/calls" },
          { label: "Practice call" },
        ]}
      />
      <Suspense fallback={<Loading />}>
        <AdminCall params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function AdminCall({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data } = await db.from("practice_calls").select(FEEDBACK_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const row = data as unknown as FeedbackCall & { va_id: string; office_id: string };
  const [office, va] = await Promise.all([
    db.from("offices").select("name, time_zone").eq("id", row.office_id).maybeSingle(),
    db.from("profiles").select("full_name, email").eq("id", row.va_id).maybeSingle(),
  ]);
  const o = office.data as { name: string; time_zone: string | null } | null;
  const v = va.data as { full_name: string | null; email: string } | null;
  return (
    <>
      <p className="font-medium">
        {v?.full_name || v?.email || "VA"} · {o?.name}
      </p>
      <CallFeedbackView call={row} timeZone={zoneOf(o?.time_zone)} audience="staff" />
      {row.status === "finished" && <OverrideCall id={id} current={row.override_result} />}
    </>
  );
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallFeedbackView, FEEDBACK_COLUMNS, type FeedbackCall } from "@/components/calls/call-feedback";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { zoneOf } from "@/lib/week";

export default function DoctorCallPage({ params }: PageProps<"/doctor/calls/[id]">) {
  return (
    <SignedInPage area="Doctor">
      <PageHeader
        title="Practice call"
        breadcrumbs={[
          { label: "Home", href: "/doctor" },
          { label: "Call practice", href: "/doctor/calls" },
          { label: "Practice call" },
        ]}
      />
      <Suspense fallback={<Loading />}>
        <DoctorCall params={params} />
      </Suspense>
    </SignedInPage>
  );
}

// Only a call made at this doctor's office.
async function DoctorCall({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("doctor");
  const { id } = await params;
  if (!user.officeId || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data } = await db.from("practice_calls").select(FEEDBACK_COLUMNS).eq("id", id).eq("office_id", user.officeId).maybeSingle();
  if (!data) notFound();
  const row = data as unknown as FeedbackCall & { va_id: string };
  const [office, va] = await Promise.all([
    db.from("offices").select("time_zone").eq("id", user.officeId).maybeSingle(),
    db.from("profiles").select("full_name, email").eq("id", row.va_id).maybeSingle(),
  ]);
  const v = va.data as { full_name: string | null; email: string } | null;
  return (
    <>
      <p className="font-medium">{v?.full_name || v?.email || "VA"}</p>
      <CallFeedbackView call={row} timeZone={zoneOf((office.data as { time_zone: string | null } | null)?.time_zone)} audience="staff" />
    </>
  );
}

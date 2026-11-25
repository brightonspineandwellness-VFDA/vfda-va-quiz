import { Suspense } from "react";
import { CallProgress } from "@/components/calls/call-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadCallsFor } from "@/lib/call-practice/progress";
import { createAdminClient } from "@/lib/supabase/server";
import { zoneOf } from "@/lib/week";

export default function DoctorCallsPage({ searchParams }: PageProps<"/doctor/calls">) {
  return (
    <SignedInPage area="Doctor">
      <PageHeader
        title="Call practice"
        description="Your VAs' practice calls with an AI patient: progress, pass rates, feedback and transcripts."
        breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "Call practice" }]}
      />
      <Suspense fallback={<Loading />}>
        <DoctorCalls searchParams={searchParams} />
      </Suspense>
    </SignedInPage>
  );
}

// Only this doctor's office.
async function DoctorCalls({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("doctor");
  if (!user.officeId) return <EmptyState title="Your account isn't linked to an office yet" />;
  const db = createAdminClient();
  const { va } = await searchParams;
  const [{ data: vaRows }, office, calls] = await Promise.all([
    db.from("profiles").select("id, full_name, email").eq("role", "va").eq("office_id", user.officeId).is("deactivated_at", null).order("full_name"),
    db.from("offices").select("time_zone").eq("id", user.officeId).maybeSingle(),
    loadCallsFor(db, { officeIds: [user.officeId] }),
  ]);
  const vas = ((vaRows ?? []) as { id: string; full_name: string | null; email: string }[]).map((v) => ({ id: v.id, name: v.full_name || v.email }));
  const one = typeof va === "string" ? vas.filter((v) => v.id === va) : [];
  const shown = one.length ? one : vas;
  return (
    <CallProgress
      vas={shown}
      calls={one.length ? calls.filter((c) => c.va_id === one[0].id) : calls}
      timeZone={zoneOf((office.data as { time_zone: string | null } | null)?.time_zone)}
      linkBase="/doctor/calls"
    />
  );
}

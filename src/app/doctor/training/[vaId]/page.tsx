import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ProgramView } from "@/components/training/program-view";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { loadProgramPage } from "@/lib/training-program";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One of the office's VAs: the training bank, the 8 sessions, sheet PDFs and "Mark session done".
export default function DoctorProgramPage({ params }: PageProps<"/doctor/training/[vaId]">) {
  return (
    <SignedInPage area="Doctor">
      <Suspense fallback={<Loading />}>
        <Program params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Program({ params }: { params: Promise<{ vaId: string }> }) {
  const user = await requireRole("doctor");
  const { vaId } = await params;
  if (!UUID.test(vaId) || !user.officeId) notFound();
  // Row-level security: only this office's VAs.
  const { data: va } = await (await createSessionClient()).from("profiles").select("full_name, email, office_id, role").eq("id", vaId).maybeSingle();
  if (!va || va.role !== "va" || va.office_id !== user.officeId) notFound();
  const name = (va.full_name || va.email) as string;
  const data = await loadProgramPage(createAdminClient(), vaId, user.officeId);
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: "/doctor" },
          { label: "My VA", href: "/doctor/va" },
          { label: "Training program" },
        ]}
        title={`${name.split(/\s+/)[0]}'s training program`}
        description={`Built from all of ${name.split(/\s+/)[0]}'s quiz days: what they already do well, what to practice, and your 4-week plan with ${name.split(/\s+/)[0]}.`}
      />
      <ProgramView data={data} vaName={name} base={`/doctor/training/${vaId}`} admin={false} />
    </>
  );
}

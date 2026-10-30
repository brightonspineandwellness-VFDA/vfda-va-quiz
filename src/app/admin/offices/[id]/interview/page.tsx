import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { StepProgress } from "@/components/setup/step-progress";
import { loadOfficeSetup } from "@/lib/interview-data";

export default function AdminInterviewPage({ params }: PageProps<"/admin/offices/[id]/interview">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/offices" className="text-sm text-foreground/60 hover:underline">
        ← Offices
      </Link>
      <Suspense fallback={<Loading />}>
        <AdminInterview params={params} />
      </Suspense>
    </SignedInPage>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function AdminInterview({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const setup = await loadOfficeSetup(id);
  if (!setup) notFound();
  const { interview: data, flow } = setup;

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {data.office.name}</h1>
      <div>
        <p className="mb-2 text-sm font-medium">Doctor&apos;s progress</p>
        <StepProgress steps={flow.steps} links={false} />
      </div>
      <Link href={`/admin/offices/${data.office.id}/rules`} className="self-start text-sm underline">
        Cards and extracted rules: review and send to doctor →
      </Link>
      <p className="text-sm text-foreground/70">
        Every rule slot for this office, including VFDA standards and automatic rules (the doctor never sees
        automatic rules). Editing a standard or an automatic rule here makes it VFDA&apos;s answer: it won&apos;t be
        refilled automatically.
      </p>
      <InterviewForm data={data} isAdmin />
    </>
  );
}

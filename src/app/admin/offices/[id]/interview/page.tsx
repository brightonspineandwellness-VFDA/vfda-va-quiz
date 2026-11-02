import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { StepProgress } from "@/components/setup/step-progress";
import { isMustAsk } from "@/lib/card-map";
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
  const { interview, flow } = setup;
  // Card-first: the cards are the source of the scenarios. Rule slots are kept
  // only for the profile, the VFDA standards, the 12 must-ask rules and the
  // automatic rules; answers already given to other slots stay in place.
  const data = {
    ...interview,
    questions: interview.questions.filter((q) => q.tier !== "doctor" || isMustAsk(q.key)),
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {data.office.name}</h1>
      <div>
        <p className="mb-2 text-sm font-medium">Doctor&apos;s progress</p>
        <StepProgress steps={flow.steps} links={false} />
      </div>
      <Link href={`/admin/offices/${data.office.id}/rules`} className="self-start text-sm underline">
        Cards: mapping, rules found on them, send to doctor →
      </Link>
      <p className="text-sm text-foreground/70">
        The office&apos;s profile, VFDA standards, the 12 must-ask rules and the automatic rules (the doctor never
        sees automatic rules). Everything else comes from the office&apos;s cards. Editing a standard or an automatic rule here makes it VFDA&apos;s answer: it won&apos;t be
        refilled automatically.
      </p>
      <InterviewForm data={data} isAdmin />
    </>
  );
}

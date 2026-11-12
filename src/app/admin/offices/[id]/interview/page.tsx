import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Card, linkClass, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { StepProgress } from "@/components/setup/step-progress";
import { isMustAsk } from "@/lib/card-map";
import { loadOfficeSetup } from "@/lib/interview-data";

export default function AdminInterviewPage({ params }: PageProps<"/admin/offices/[id]/interview">) {
  return (
    <SignedInPage area="VFDA admin">
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
      <PageHeader
        title={`Office setup: ${data.office.name}`}
        description="The office's profile, VFDA standards, the 12 must-ask rules and the automatic rules."
        breadcrumbs={[
          { label: "Offices", href: "/admin/offices" },
          { label: data.office.name, href: `/admin/offices/${data.office.id}` },
          { label: "Standards & must-ask rules" },
        ]}
        actions={
          <Link href={`/admin/offices/${data.office.id}/rules`} className={`${linkClass} text-sm`}>
            Cards: mapping and the rules read from them →
          </Link>
        }
      />
      <Card title="Doctor's progress">
        <StepProgress steps={flow.steps} links={false} />
      </Card>
      <p className="text-sm text-muted">
        The office&apos;s profile, VFDA standards, the 12 must-ask rules and the automatic rules (the doctor never
        sees automatic rules). Everything else comes from the office&apos;s cards. Editing a standard or an automatic rule here makes it VFDA&apos;s answer: it won&apos;t be
        refilled automatically.
      </p>
      <InterviewForm data={data} isAdmin />
    </>
  );
}

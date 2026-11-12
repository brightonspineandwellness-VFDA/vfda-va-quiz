import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
import { nextButton } from "@/components/setup/locked-step";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "./load";

export default function DoctorSetupPage() {
  return (
    <SignedInPage area="Doctor">
      <Suspense fallback={<Loading />}>
        <ProfileStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 1: only the 8 profile-tier questions. No card rules are asked before
// the cards have been read.
async function ProfileStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <Notice tone="info" title="Your office isn't set up yet">Contact VFDA.</Notice>;
  const { interview, flow } = setup;
  const data = { ...interview, questions: interview.questions.filter((q) => q.tier === "profile"), quizzes: [] };

  return (
    <>
      <PageHeader
        title={`Office setup: ${interview.office.name}`}
        description="Three short steps so your VA learns your office's way."
        breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "Office setup", href: "/doctor/setup" }, { label: "Profile" }]}
      />
      <StepProgress steps={flow.steps} current="profile" />
      <Card number={1} title="Profile" description={`${flow.profileTotal} questions about your office. You can leave and come back any time.`}>
        <InterviewForm data={data} isAdmin={false} showGrayCards={false} />
      </Card>
      <Link href="/doctor/setup/upload" className={nextButton}>
        Next: Upload your cards →
      </Link>
    </>
  );
}

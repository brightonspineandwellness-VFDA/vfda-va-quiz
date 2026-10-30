import Link from "next/link";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
import { nextButton } from "@/components/setup/locked-step";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "./load";

export default function DoctorSetupPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor" className="text-sm text-foreground/60 hover:underline">
        ← Home
      </Link>
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
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  const data = { ...interview, questions: interview.questions.filter((q) => q.tier === "profile"), quizzes: [] };

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="profile" />
      <div>
        <h2 className="text-xl font-semibold">Step 1 · Profile</h2>
        <p className="text-foreground/70">
          {flow.profileTotal} questions about your office. You can leave and come back any time.
        </p>
      </div>
      <InterviewForm data={data} isAdmin={false} showGrayCards={false} />
      <Link href="/doctor/setup/upload" className={nextButton}>
        Next: Upload your cards →
      </Link>
    </>
  );
}

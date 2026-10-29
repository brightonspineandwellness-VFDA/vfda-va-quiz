import Link from "next/link";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
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
        <SetupStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 1: only the profile-tier questions (and gray cards if the office has them).
async function SetupStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  const data = { ...interview, questions: interview.questions.filter((q) => q.tier === "profile"), quizzes: [] };

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="setup" />
      <div>
        <h2 className="text-xl font-semibold">Step 1 · Setup</h2>
        <p className="text-foreground/70">
          {flow.profileTotal} questions about your office. You can leave and come back any time.
        </p>
      </div>
      <InterviewForm data={data} isAdmin={false} />
      <Link
        href="/doctor/setup/cards"
        className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background"
      >
        Next: Your cards →
      </Link>
    </>
  );
}

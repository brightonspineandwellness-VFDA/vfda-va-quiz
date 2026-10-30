import Link from "next/link";
import { Suspense } from "react";
import { nextButton } from "@/components/setup/locked-step";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "../load";

export default function ReviewPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/upload" className="text-sm text-foreground/60 hover:underline">
        ← Upload your cards
      </Link>
      <Suspense fallback={<Loading />}>
        <ReviewStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 3: nothing for the doctor to do until VFDA sends the rules.
async function ReviewStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow, state } = setup;
  const step = flow.steps.find((s) => s.key === "review")!;

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="review" />
      <h2 className="text-xl font-semibold">Step 3 · Waiting for VFDA review</h2>

      {!state.cardsUploadedAt ? (
        <div className="flex flex-col gap-3">
          <p>Upload your cards first, then press Done uploading.</p>
          <Link href="/doctor/setup/upload" className={nextButton}>
            Upload your cards →
          </Link>
        </div>
      ) : !flow.unlocked ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="text-lg font-medium">We&apos;re reading your cards</p>
          <p className="mt-1">
            We pull the rules your VA needs out of your cards, and VFDA checks each one. When VFDA is done,
            you&apos;ll confirm the rules and answer a short list of questions. You can close this page; we&apos;ll
            pick up where you left off.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>
            {step.state === "waiting"
              ? "VFDA is checking the cards you added. Anything new will show up in your questions when they're done. You can carry on meanwhile."
              : "VFDA has reviewed your cards. ✓"}
          </p>
          <Link href="/doctor/setup/confirm" className={nextButton}>
            Next: Confirm your rules →
          </Link>
        </div>
      )}
    </>
  );
}

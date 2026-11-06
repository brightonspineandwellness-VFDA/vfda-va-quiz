import Link from "next/link";
import { Suspense } from "react";
import { StandardsCheckbox } from "@/components/setup/standards-checkbox";
import { ByLine } from "@/components/setup/by-line";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "../load";

export default function StandardsPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/upload" className="text-sm text-foreground/60 hover:underline">
        ← Upload your cards
      </Link>
      <Suspense fallback={<Loading />}>
        <StandardsStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 3: one checkbox. Where the cards are silent, the VA follows the VFDA
// standards; the full list is one click away, nothing to review item by item.
// The four safety standards (red flags, emergency script, patient ID,
// privacy) apply whatever the cards say.
async function StandardsStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="standards" />
      <h2 className="text-xl font-semibold">Step 3 · VFDA standards</h2>
      {
        <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
          <StandardsCheckbox accepted={flow.standardsAccepted} />
          <p className="text-sm text-foreground/70">
            Your cards come first. Where they don&apos;t say how something is done, your VA follows VFDA&apos;s
            standard way ({flow.standards.length} standards). VFDA&apos;s safety standards (red flags, the emergency
            script, checking a patient&apos;s identity, privacy) always apply.{" "}
            <Link href="/doctor/setup/standards/all" className="underline">
              View
            </Link>
          </p>
          {flow.standardsAccepted && (
            <>
              <ByLine verb="Accepted" name={flow.standardsAcceptedBy} at={flow.standardsAcceptedAt} />
              <p className="text-green-700 dark:text-green-400">Setup done. Thank you! ✓</p>
            </>
          )}
        </div>
      }
    </>
  );
}

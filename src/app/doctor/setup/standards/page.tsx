import Link from "next/link";
import { Card, linkClass, Notice, PageHeader } from "@/components/ui";
import { Suspense } from "react";
import { StandardsCheckbox } from "@/components/setup/standards-checkbox";
import { ByLine } from "@/components/setup/by-line";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "../load";

export default function StandardsPage() {
  return (
    <SignedInPage area="Doctor">
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
  if (!setup) return <Notice tone="info" title="Your office isn't set up yet">Contact VFDA.</Notice>;
  const { interview, flow } = setup;

  return (
    <>
      <PageHeader
        title={`Office setup: ${interview.office.name}`}
        description="Where your cards are silent, your VA follows VFDA's standard way."
        breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "Office setup", href: "/doctor/setup" }, { label: "VFDA standards" }]}
      />
      <StepProgress steps={flow.steps} current="standards" />
      {
        <Card number={3} title="VFDA standards">
          <StandardsCheckbox accepted={flow.standardsAccepted} />
          <p className="text-[0.9375rem] text-muted">
            Your cards come first. Where they don&apos;t say how something is done, your VA follows VFDA&apos;s
            standard way ({flow.standards.length} standards). VFDA&apos;s safety standards (red flags, the emergency
            script, checking a patient&apos;s identity, privacy) always apply.{" "}
            <Link href="/doctor/setup/standards/all" className={linkClass}>
              View
            </Link>
          </p>
          {flow.standardsAccepted && (
            <>
              <ByLine verb="Accepted" name={flow.standardsAcceptedBy} at={flow.standardsAcceptedAt} />
              <Notice tone="success" title="Setup done. Thank you! ✓" />
            </>
          )}
        </Card>
      }
    </>
  );
}

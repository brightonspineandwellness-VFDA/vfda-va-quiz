import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { CardUpload, NoPatientInfoWarning } from "@/components/setup/card-upload";
import { nextButton } from "@/components/setup/locked-step";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { finishUploading } from "@/lib/card-actions";
import { loadDoctorSetup } from "../load";

// "Done uploading" reads the cards with the Claude API after the response is
// sent; give it time to finish.
export const maxDuration = 300;

export default function UploadPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup" className="text-sm text-foreground/60 hover:underline">
        ← Profile
      </Link>
      <Suspense fallback={<Loading />}>
        <UploadStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 2: the Trello cards as PDFs.
async function UploadStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow, documents, state } = setup;
  const officeId = interview.office.id;
  const pending = flow.newDocuments.length;

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="upload" />
      <div>
        <h2 className="text-xl font-semibold">Step 2 · Upload your cards</h2>
        <p className="text-foreground/70">
          Export each Trello card as a PDF and upload it next to its name. We read the rules your VA needs from
          them, so you only answer what the cards don&apos;t cover. Skip any card your office doesn&apos;t have.
        </p>
      </div>
      <NoPatientInfoWarning />
      <CardUpload officeId={officeId} documents={documents} />

      <div className="flex flex-wrap items-center gap-3">
        {pending > 0 ? (
          <ActionButton
            action={finishUploading.bind(null, officeId)}
            label={state.cardsUploadedAt ? `Done uploading (${pending} new)` : "Done uploading"}
            pendingLabel="Starting…"
            primary
          />
        ) : state.cardsUploadedAt ? (
          <Link href="/doctor/setup/review" className={nextButton}>
            Next: Waiting for VFDA review →
          </Link>
        ) : (
          <p className="text-sm text-foreground/70">Upload at least one card to continue.</p>
        )}
      </div>
      {state.cardsUploadedAt && pending === 0 && (
        <p className="text-sm text-foreground/70">
          Found another card later? Upload it here and press Done uploading again. We&apos;ll only ask about rules
          that are still missing.
        </p>
      )}
    </>
  );
}

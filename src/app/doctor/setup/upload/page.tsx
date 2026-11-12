import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
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
      <Suspense fallback={<Loading />}>
        <UploadStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 2: the Trello cards as PDFs.
async function UploadStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <Notice tone="info" title="Your office isn't set up yet">Contact VFDA.</Notice>;
  const { interview, flow, documents, state } = setup;
  const officeId = interview.office.id;
  const pending = flow.newDocuments.length;

  return (
    <>
      <PageHeader
        title={`Office setup: ${interview.office.name}`}
        description="Upload each Trello card as a PDF so your VA learns your office's rules."
        breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "Office setup", href: "/doctor/setup" }, { label: "Upload your cards" }]}
      />
      <StepProgress steps={flow.steps} current="upload" />
      <Card
        number={2}
        title="Upload your cards"
        description={
          <>
            Export each Trello card as a PDF and upload it next to its name. We read the rules your VA needs from
            them, so you only answer what the cards don&apos;t cover. No card for a topic? Press &ldquo;We don&apos;t have
            this card&rdquo;: your VA then learns VFDA&apos;s standard way for it.
          </>
        }
      >
        <NoPatientInfoWarning />
        <CardUpload officeId={officeId} documents={documents} missing={setup.missingCards} />

      <div className="flex flex-wrap items-center gap-3">
        {pending > 0 || (!state.cardsUploadedAt && documents.length === 0 && flow.uncoveredTopics.length === 0) ? (
          <ActionButton
            action={finishUploading.bind(null, officeId)}
            label={state.cardsUploadedAt ? `Done uploading (${pending} new)` : "Done uploading"}
            pendingLabel="Starting…"
            primary
          />
        ) : state.cardsUploadedAt ? (
          <Link href="/doctor/setup/standards" className={nextButton}>
            Next: VFDA standards →
          </Link>
        ) : (
          <p className="text-sm text-muted">Upload at least one card to continue.</p>
        )}
      </div>
      {flow.uncoveredTopics.length > 0 && (
        <p className="text-sm text-muted">
          Still to do: {flow.uncoveredTopics.join(", ")}. Upload the card, or mark &ldquo;We don&apos;t have this card&rdquo;.
        </p>
      )}
      {state.cardsUploadedAt && pending === 0 && (
        <p className="text-sm text-muted">
          Found another card later? Upload it here and press Done uploading again. We&apos;ll only ask about rules
          that are still missing.
        </p>
      )}
      </Card>
    </>
  );
}

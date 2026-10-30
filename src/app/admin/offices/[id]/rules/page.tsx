import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { CardUpload, NoPatientInfoWarning } from "@/components/setup/card-upload";
import { RuleEditor } from "@/components/setup/rule-editor";
import { RuleSource } from "@/components/setup/rule-source";
import { RuleValue } from "@/components/setup/rule-value";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { finishUploading } from "@/lib/card-actions";
import type { OfficeState, RuleRow } from "@/lib/doctor-flow";
import type { InterviewQuestion } from "@/lib/interview";
import { loadOfficeSetup } from "@/lib/interview-data";
import { editAndAcceptRule, removeEdgeCase, reviewRule, sendToDoctor } from "@/lib/review-actions";

// "Done uploading" / "Try again" read the cards after the response is sent.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminRulesPage({ params }: PageProps<"/admin/offices/[id]/rules">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/offices" className="text-sm text-foreground/60 hover:underline">
        ← Offices
      </Link>
      <Suspense fallback={<Loading />}>
        <AdminRules params={params} />
      </Suspense>
    </SignedInPage>
  );
}

const STATUS_LABELS: Record<RuleRow["status"], string> = {
  proposed: "To review",
  needs_doctor: "Accepted: doctor confirms",
  accepted: "Confirmed by doctor",
  rejected: "Rejected",
};

async function AdminRules({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const setup = await loadOfficeSetup(id);
  if (!setup) notFound();
  const { interview, flow, state, documents, rules, gaps, gapPlan } = setup;
  const officeId = interview.office.id;

  const cardRows = rules.filter((r) => r.source === "card_import");
  const toReview = cardRows.filter((r) => r.status === "proposed").length;
  const slots = interview.questions.filter((q) => cardRows.some((r) => r.rule_slot_key === q.key));
  const standardFor = (key: string) =>
    rules.find((r) => r.rule_slot_key === key && r.source_document_id === null && r.source === "vfda_default");
  const edgeCases = gaps.filter((g) => g.reason === "edge_case");
  const unreleased = gaps.filter((g) => g.released_at === null).length;
  const adds = gapPlan.add.length;
  const reasons = (["not_found", "partial", "conflicting"] as const)
    .map((r) => [r, gapPlan.add.filter((g) => g.reason === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n} ${r.replace("_", " ")}`);
  const canSend = state.extractionStatus === "done" && toReview === 0 && !!state.cardsUploadedAt;
  const sendNeeded = !state.sentToDoctorAt || adds + gapPlan.update.length + gapPlan.remove.length + unreleased > 0;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Card rules: {interview.office.name}</h1>
        <p className="text-sm">
          <Link href={`/admin/offices/${officeId}/interview`} className="underline">
            Full office setup (every rule slot) →
          </Link>
        </p>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Doctor&apos;s progress</p>
        <StepProgress steps={flow.steps} links={false} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">1. Cards</h2>
        <NoPatientInfoWarning />
        <CardUpload officeId={officeId} documents={documents} />
        <div className="flex flex-wrap items-center gap-3">
          {flow.newDocuments.length > 0 && (
            <ActionButton
              action={finishUploading.bind(null, officeId)}
              label={`Done uploading: read ${flow.newDocuments.length} new card${flow.newDocuments.length > 1 ? "s" : ""}`}
              pendingLabel="Starting…"
              primary
            />
          )}
          <ExtractionStatus state={state} officeId={officeId} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">2. Review extracted rules</h2>
        <p className="text-sm text-foreground/70">
          {cardRows.length === 0
            ? "Nothing extracted yet."
            : toReview > 0
              ? `${toReview} to review. Accept what the card says, fix the wording, or reject it. Accepted rules go to the doctor to confirm.`
              : "All reviewed."}
        </p>
        {slots.map((slot) => (
          <SlotReview
            key={slot.key}
            slot={slot}
            rows={cardRows.filter((r) => r.rule_slot_key === slot.key)}
            standard={standardFor(slot.key)?.rule ?? null}
            fileUrls={interview.fileUrls}
            officeId={officeId}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">3. Edge-case questions</h2>
        <p className="text-sm text-foreground/70">
          At most one per workflow, where the cards are silent on a risk. Remove any the doctor doesn&apos;t need.
        </p>
        {edgeCases.length === 0 ? (
          <p className="text-sm text-foreground/60">None.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {edgeCases.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-foreground/15 px-4 py-3">
                <span>
                  <span className="mr-2 font-mono text-xs text-foreground/60">{g.workflow}</span>
                  {g.question}
                  <span className="block text-xs text-foreground/60">
                    {g.answered_at ? "Answered" : g.released_at ? "With the doctor" : "Not sent yet"}
                  </span>
                </span>
                {!g.answered_at && <ActionButton action={removeEdgeCase.bind(null, g.id)} label="Remove" pendingLabel="Removing…" />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-foreground/10 pt-4">
        <h2 className="text-xl font-semibold">4. Send to doctor</h2>
        {state.sentToDoctorAt && (
          <p className="text-sm text-foreground/70">
            Sent on {new Date(state.sentToDoctorAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.
          </p>
        )}
        {sendNeeded ? (
          <>
            <p className="text-sm">
              {adds > 0 ? `Adds ${adds} gap question${adds > 1 ? "s" : ""} (${reasons.join(", ")})` : "No new rule questions"}
              {unreleased - adds > 0 && ` and ${unreleased - adds} edge-case question${unreleased - adds > 1 ? "s" : ""}`}
              {gapPlan.remove.length > 0 && `; removes ${gapPlan.remove.length} no longer needed`}. Questions the doctor
              already answered are never asked again.
            </p>
            <ActionButton action={sendToDoctor.bind(null, officeId)} label="Send to doctor" pendingLabel="Sending…" primary disabled={!canSend} />
            {!canSend && (
              <p className="text-sm text-foreground/60">
                {!state.cardsUploadedAt
                  ? "Waiting for cards."
                  : state.extractionStatus !== "done"
                    ? "Waiting for the cards to be read."
                    : "Review every extracted rule first."}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-green-700 dark:text-green-400">The doctor has everything. ✓</p>
        )}
      </section>
    </>
  );
}

function ExtractionStatus({ state, officeId }: { state: OfficeState; officeId: string }) {
  switch (state.extractionStatus) {
    case "running":
      return <p className="text-sm text-amber-700 dark:text-amber-300">Reading cards… (refresh in a minute)</p>;
    case "failed":
      return (
        <span className="flex flex-col gap-2">
          <span className="text-sm text-red-700 dark:text-red-400">
            Reading the cards failed{state.extractionError ? `: ${state.extractionError}` : "."}
          </span>
          <ActionButton action={finishUploading.bind(null, officeId)} label="Try again" pendingLabel="Starting…" />
        </span>
      );
    case "done":
      return <p className="text-sm text-green-700 dark:text-green-400">Cards read ✓</p>;
    default:
      return <p className="text-sm text-foreground/60">Not read yet.</p>;
  }
}

function SlotReview({
  slot,
  rows,
  standard,
  fileUrls,
  officeId,
}: {
  slot: InterviewQuestion;
  rows: RuleRow[];
  standard: unknown;
  fileUrls: Record<string, string>;
  officeId: string;
}) {
  const live = rows.filter((r) => r.status !== "rejected");
  const conflicting = new Set(live.map((r) => JSON.stringify(r.rule))).size > 1;
  return (
    <article id={`slot-${slot.key}`} className="flex flex-col gap-3 rounded-lg border border-foreground/15 p-4">
      <div>
        <p className="font-medium">{slot.question}</p>
        <p className="text-xs text-foreground/50">
          <span className="font-mono">{slot.key}</span> · {slot.tier === "default" ? "VFDA standard" : slot.card_group}
          {conflicting && <span className="ml-1 font-medium text-amber-700 dark:text-amber-300">· cards disagree</span>}
        </p>
      </div>
      {slot.tier === "default" && standard !== null && (
        <div className="text-xs text-foreground/60">
          VFDA standard: <RuleValue slot={slot} value={standard as never} />
          <span>If you accept the card&apos;s version, the doctor chooses between them on the VFDA standards page.</span>
        </div>
      )}
      <div className={`grid gap-3 ${rows.length > 1 ? "md:grid-cols-2" : ""}`}>
        {rows.map((row) => (
          <div key={row.id} className={`flex flex-col gap-2 rounded-md bg-foreground/5 px-3 py-2 ${row.status === "rejected" ? "opacity-60" : ""}`}>
            <div className="text-sm">
              <RuleValue slot={slot} value={row.rule} />
            </div>
            <RuleSource row={row} />
            <p className="text-xs font-medium">{STATUS_LABELS[row.status]}</p>
            {row.status !== "accepted" && (
              <div className="flex flex-wrap items-start gap-2">
                {row.status !== "needs_doctor" && (
                  <ActionButton action={reviewRule.bind(null, row.id, "accept")} label="Accept" primary={row.status === "proposed"} />
                )}
                {row.status !== "rejected" && <ActionButton action={reviewRule.bind(null, row.id, "reject")} label="Reject" />}
                <RuleEditor
                  officeId={officeId}
                  slot={slot}
                  value={row.rule}
                  fileUrls={fileUrls}
                  save={editAndAcceptRule.bind(null, row.id)}
                  saveLabel="Save and accept"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

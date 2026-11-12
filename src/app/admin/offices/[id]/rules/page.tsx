import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { CardMapping } from "@/components/setup/card-mapping";
import { CardUpload, NoPatientInfoWarning } from "@/components/setup/card-upload";
import { ExtraWorkflowEditor } from "@/components/setup/extra-workflow-editor";
import { RuleEditor } from "@/components/setup/rule-editor";
import { RuleSource } from "@/components/setup/rule-source";
import { RuleValue } from "@/components/setup/rule-value";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, Card, EmptyState, linkClass, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { finishUploading } from "@/lib/card-actions";
import { GRAY_DAY, isMustAsk, LOCKED_STANDARDS } from "@/lib/card-map";
import { loadExtraWorkflows } from "@/lib/extra-workflows";
import type { OfficeState, RuleRow } from "@/lib/doctor-flow";
import type { InterviewQuestion } from "@/lib/interview";
import { loadOfficeSetup } from "@/lib/interview-data";
import { correctRule } from "@/lib/review-actions";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

// "Done uploading" / "Try again" read the cards after the response is sent.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminRulesPage({ params }: PageProps<"/admin/offices/[id]/rules">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <AdminRules params={params} />
      </Suspense>
    </SignedInPage>
  );
}


async function AdminRules({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const setup = await loadOfficeSetup(id);
  if (!setup) notFound();
  const { interview, flow, state, documents, rules } = setup;
  const officeId = interview.office.id;
  const { data: standardWorkflows } = await (await createSessionClient()).from("workflows").select("code, name").order("code");
  const workflowOptions = [
    ...(standardWorkflows ?? []),
    ...interview.grayCards.map((c) => ({ code: c.code, name: String(c.answers.CARD_NAME ?? "Gray card") })),
  ];
  const dayOptions = interview.quizzes.filter((q) => /^W\dD\d$/.test(q.code)).map((q) => ({ code: q.code, title: q.title }));
  const unmapped = documents.filter((d) => d.imported_at && !d.skip && !(d.schedule_days ?? []).length).length;
  // Extra cards: their workflows, and gray cards found to cover a standard topic.
  const extra = await loadExtraWorkflows(createAdminClient(), officeId);
  const matched = documents.filter(
    (d) => d.card_name === "Gray cards" && d.imported_at && !d.skip && (d.schedule_days ?? []).length && !(d.schedule_days ?? []).includes(GRAY_DAY),
  );
  const extraWaiting = documents.filter(
    (d) => d.imported_at && !d.skip && (d.schedule_days ?? []).includes(GRAY_DAY) && !extra.some((w) => w.card?.id === d.id),
  ).length;

  // Rules read from the cards apply at once, each card's own (a misread can be corrected).
  const cardRows = rules.filter((r) => r.source === "card_import" && r.status !== "rejected");
  // The doctor's own answers (VA Office Rules card).
  const officeRuleRows = rules.filter((r) => r.source === "doctor_card" && r.status === "accepted");
  const slots = interview.questions.filter((q) => cardRows.some((r) => r.rule_slot_key === q.key));
  const standardFor = (key: string) =>
    rules.find((r) => r.rule_slot_key === key && r.source_document_id === null && r.source === "vfda_default");
  // Must-ask rules no card covers: VFDA's suggestion, or nothing yet.
  const mustAsk = interview.questions.filter((q) => q.tier === "doctor" && isMustAsk(q.key));
  const covered = (key: string) => rules.some((r) => r.rule_slot_key === key && (r.source === "card_import" || r.source === "doctor_card" || r.source === "doctor") && r.status !== "rejected");
  const usingDefault = mustAsk.filter((q) => !covered(q.key) && standardFor(q.key));
  const blank = mustAsk.filter((q) => !covered(q.key) && !standardFor(q.key));

  return (
    <>
      <PageHeader
        title={`Cards: ${interview.office.name}`}
        description="The office's cards, how they map to training days, and the rules read from them."
        breadcrumbs={[
          { label: "Offices", href: "/admin/offices" },
          { label: interview.office.name, href: `/admin/offices/${officeId}` },
          { label: "Cards & rules" },
        ]}
        actions={
          <Link href={`/admin/offices/${officeId}/interview`} className={`${linkClass} text-sm`}>
            Full office setup (every rule slot) →
          </Link>
        }
      />
      <Card title="Doctor's progress">
        <StepProgress steps={flow.steps} links={false} />
      </Card>

      <Card number={1} title="Cards">
        <NoPatientInfoWarning />
        <CardUpload officeId={officeId} documents={documents} missing={setup.missingCards} />
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
      </Card>

      <Card number={2} title="Card mapping">
        <p className="text-sm text-muted">
          The cards are the source of this office&apos;s scenarios: each day is written from the cards mapped to it,
          with the master bank as the pattern. Suggested from each card&apos;s name and color (green and orange: week
          1, yellow: week 2, gray: {"W2D5"} gray card scenarios). Change anything that&apos;s off; mark cards with only
          links or nothing in them as skip.
          {unmapped > 0 && <span className="font-semibold text-warning"> {unmapped} card(s) have no day yet.</span>}
        </p>
        {matched.length > 0 && (
          <p className="text-sm text-muted">
            Uploaded as extra cards, but they cover a standard topic, so they&apos;re suggested for that topic&apos;s day:{" "}
            {matched.map((d) => `${d.card_title || d.file_name} (${(d.schedule_days ?? []).join(", ")})`).join("; ")}. Map them to{" "}
            {GRAY_DAY} to keep them as extra cards.
          </p>
        )}
        <CardMapping documents={documents} days={dayOptions} workflows={workflowOptions} />
        <Link href={`/admin/offices/${officeId}/scenarios`} className={`${linkClass} self-start text-sm`}>
          Build scenarios →
        </Link>
      </Card>

      <Card title="Extra cards: workflows">
        <p className="text-sm text-muted">
          Each extra card (mapped to {GRAY_DAY}) is read into a workflow. Process cards get a task scenario (the card&apos;s
          steps are the answer; skipping its approval or escalation is the critical fail), info only cards a question. A
          phone-call process is trained on W2D1 or W2D2 instead. Edit anything that&apos;s off, then approve: scenarios are
          built only from approved workflows. Each one is certified like the standard workflows; its SOP is the card itself
          on Trello.
        </p>
        {extraWaiting > 0 && (
          <Notice tone="warning">
            <p>{extraWaiting} extra card(s) still being read (refresh in a minute).</p>
          </Notice>
        )}
        {!extra.length && !extraWaiting && <EmptyState title="No extra cards">Cards mapped to {GRAY_DAY} show here as workflows.</EmptyState>}
        {extra.map((w) => (
          <ExtraWorkflowEditor
            key={`${w.id}:${w.approved_at ?? ""}:${w.steps.join("|")}:${w.name}`}
            workflow={{
              id: w.id,
              code: w.code,
              name: w.name,
              kind: w.kind,
              phone: w.phone,
              trigger: w.trigger,
              steps: w.steps,
              definition_of_done: w.definition_of_done,
              va_can_decide: w.va_can_decide,
              requires_approval: w.requires_approval,
              immediate_escalation: w.immediate_escalation,
              approved: !!w.approved_at,
              cardTitle: w.card?.title ?? "",
              quotes: w.source_quotes,
              patientFacing: w.patient_facing,
              risky: w.risky,
            }}
          />
        ))}
      </Card>

      <Card number={3} title="Rules read from the cards">
        <p className="text-sm text-muted">
          Only VFDA standards and the 12 must-ask rules are read from the cards as rules. They apply at once, each
          card&apos;s own protocol to the scenarios built from that card; nobody is asked to confirm them. Correct one
          only if the reading got it wrong. VFDA&apos;s safety standards (red flags, emergency script, patient ID check,
          privacy) apply whatever a card says.{" "}
          <span className="font-semibold text-foreground">{cardRows.length === 0 ? "Nothing found yet." : `${cardRows.length} found.`}</span>
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
        {officeRuleRows.length > 0 && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface-muted p-4">
            <p className="font-semibold">From the doctor&apos;s VA Office Rules card</p>
            <p className="text-sm text-muted">
              The doctor&apos;s own answers (&ldquo;VFDA default&rdquo; is VFDA&apos;s suggestion, taken as theirs). Saved as
              accepted; no review needed, and the doctor isn&apos;t asked these again.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {officeRuleRows.map((row) => {
                const slot = interview.questions.find((q) => q.key === row.rule_slot_key);
                return (
                  <li key={row.id}>
                    <span className="font-mono text-xs text-muted">{row.rule_slot_key}</span>{" "}
                    {slot ? <RuleValue slot={slot} value={row.rule} /> : String(row.rule)}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Card number={4} title="Must-ask rules no card covers">
        <p className="text-sm text-muted">
          The doctor is never asked. These use VFDA&apos;s suggestion and are listed in the{" "}
          <Link href={`/admin/offices/${officeId}/report`} className={linkClass}>
            SOP gap report (VFDA only)
          </Link>
          .
        </p>
        {usingDefault.length === 0 && blank.length === 0 && (
          <Notice tone="success">
            <p>The cards cover every must-ask rule. ✓</p>
          </Notice>
        )}
        {usingDefault.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {usingDefault.map((q) => (
              <li key={q.key}>
                <span className="font-mono text-xs text-muted">{q.key}</span> <Badge tone="info">VFDA default</Badge>{" "}
                <RuleValue slot={q} value={standardFor(q.key)!.rule} />
              </li>
            ))}
          </ul>
        )}
        {blank.length > 0 && (
          <Notice tone="warning">
            <p>
              No card and no VFDA suggestion: {blank.map((q) => q.key).join(", ")}. Scenarios needing them wait for a value on
              their review screen.
            </p>
          </Notice>
        )}
      </Card>
    </>
  );
}

function ExtractionStatus({ state, officeId }: { state: OfficeState; officeId: string }) {
  switch (state.extractionStatus) {
    case "running":
      return <Badge tone="warning">Reading cards… (refresh in a minute)</Badge>;
    case "failed":
      return (
        <span className="flex flex-col gap-2">
          <span className="text-sm font-medium text-danger">
            Reading the cards failed{state.extractionError ? `: ${state.extractionError}` : "."}
          </span>
          <ActionButton action={finishUploading.bind(null, officeId)} label="Try again" pendingLabel="Starting…" />
        </span>
      );
    case "done":
      return <Badge tone="success">Cards read ✓</Badge>;
    default:
      return <Badge tone="neutral">Not read yet</Badge>;
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
  const locked = LOCKED_STANDARDS.includes(slot.key);
  return (
    <article id={`slot-${slot.key}`} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div>
        <p className="font-semibold">{slot.question}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="font-mono">{slot.key}</span> · {slot.tier === "default" ? "VFDA standard" : slot.card_group}
          {locked && <Badge tone="danger">Locked safety standard</Badge>}
        </p>
      </div>
      {slot.tier === "default" && standard !== null && (
        <div className="text-sm text-muted">
          VFDA standard: <RuleValue slot={slot} value={standard as never} />
          <span>
            {locked
              ? " This one always applies: the card's version is kept for the report only."
              : " The card's version replaces it for the scenarios built from that card."}
          </span>
        </div>
      )}
      <div className={`grid gap-3 ${rows.length > 1 ? "md:grid-cols-2" : ""}`}>
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface-muted px-3 py-3">
            <div className="text-sm">
              <RuleValue slot={slot} value={row.rule} />
            </div>
            <RuleSource row={row} />
            <div className="flex flex-wrap items-start gap-2">
              <RuleEditor officeId={officeId} slot={slot} value={row.rule} fileUrls={fileUrls} save={correctRule.bind(null, row.id)} saveLabel="Save correction" editLabel="Correct" />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

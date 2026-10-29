import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { RuleEditor } from "@/components/setup/rule-editor";
import { RuleValue } from "@/components/setup/rule-value";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import type { StandardItem } from "@/lib/doctor-flow";
import { acceptAllStandards, keepStandard, useCardVersion } from "@/lib/setup-actions";
import { loadDoctorSetup } from "../load";

export default function StandardsPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/cards" className="text-sm text-foreground/60 hover:underline">
        ← Your cards
      </Link>
      <Suspense fallback={<Loading />}>
        <StandardsStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 3: every default-tier rule, already in place as a VFDA standard.
async function StandardsStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  const items = flow.standards;
  const open = items.filter((s) => !s.accepted && !s.override).length;
  const overrides = items.filter((s) => s.override);

  const acceptAll = (
    <div className="flex flex-wrap items-center gap-3">
      {open > 0 ? (
        <ActionButton action={acceptAllStandards} label={`Accept all (${open})`} primary />
      ) : (
        overrides.length === 0 && <p className="text-green-700 dark:text-green-400">All standards accepted ✓</p>
      )}
      {overrides.length > 0 && (
        <p className="text-sm text-foreground/70">
          {overrides.length} where your cards say something different: choose below.
        </p>
      )}
    </div>
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="standards" />
      <div>
        <h2 className="text-xl font-semibold">Step 3 · VFDA standards</h2>
        <p className="text-foreground/70">
          How VFDA trains every VA unless you tell us otherwise. They&apos;re already in place; accept them, or edit
          any that your office does differently.
        </p>
      </div>
      {acceptAll}

      <ul className="flex flex-col gap-3">
        {[...overrides, ...items.filter((s) => !s.override)].map((item) => (
          <li key={item.slot.key}>
            <Standard item={item} officeId={interview.office.id} fileUrls={interview.fileUrls} />
          </li>
        ))}
      </ul>

      {items.length > 8 && acceptAll}
    </>
  );
}

function Standard({ item, officeId, fileUrls }: { item: StandardItem; officeId: string; fileUrls: Record<string, string> }) {
  const { slot, row, override } = item;
  return (
    <article
      id={`rule-${slot.key}`}
      className={`flex flex-col gap-2 rounded-lg border p-4 ${override ? "border-amber-300 dark:border-amber-700" : "border-foreground/15"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{slot.question}</p>
        <span className="shrink-0 text-xs text-foreground/60">
          {item.accepted ? (
            <span className="text-green-700 dark:text-green-400">
              {row?.source === "doctor" ? "Your version ✓" : "Accepted ✓"}
            </span>
          ) : (
            "VFDA standard"
          )}
        </span>
      </div>
      <div className="text-sm">
        <RuleValue slot={slot} value={row?.rule ?? null} attachments={row?.attachments} fileUrls={fileUrls} />
      </div>

      {override && (
        <div className="flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950">
          <p className="font-medium">Your card says something different:</p>
          <RuleValue slot={slot} value={override.rule} />
          <p className="text-xs text-foreground/60">
            From <span className="font-medium">{override.document_name ?? "your cards"}</span>
            {override.source_quote && <>: &ldquo;{override.source_quote}&rdquo;</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton action={useCardVersion.bind(null, override.id)} label="Use my card's version" primary />
            <ActionButton action={keepStandard.bind(null, override.id)} label="Keep VFDA standard" />
          </div>
        </div>
      )}

      <div>
        <RuleEditor officeId={officeId} slot={slot} value={row?.rule ?? null} attachments={row?.attachments} fileUrls={fileUrls} />
      </div>
    </article>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { RuleEditor } from "@/components/setup/rule-editor";
import { RuleValue } from "@/components/setup/rule-value";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import type { CardItem, RuleRow } from "@/lib/doctor-flow";
import { confirmCardGroup } from "@/lib/setup-actions";
import { loadDoctorSetup } from "../../load";

export default function CardGroupPage({ params }: PageProps<"/doctor/setup/cards/[slug]">) {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/cards" className="text-sm text-foreground/60 hover:underline">
        ← Your cards
      </Link>
      <Suspense fallback={<Loading />}>
        <CardGroupScreen params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function CardGroupScreen({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  const index = flow.groups.findIndex((g) => g.slug === slug);
  if (index < 0 || !flow.cardsReady) notFound();
  const group = flow.groups[index];
  const prev = flow.groups[index - 1];
  const next = flow.groups[index + 1];
  const rules = group.items.filter((i) => i.kind === "rule");
  const questions = group.items.filter((i) => i.kind === "question");
  const toConfirm = rules.filter((i) => !i.confirmed).length;
  const officeId = interview.office.id;

  return (
    <>
      <StepProgress steps={flow.steps} current="cards" />
      <div>
        <p className="text-sm text-foreground/60">
          Your cards · {index + 1} of {flow.groups.length}
        </p>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
      </div>

      {rules.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">From your cards</h2>
          {rules.map((item) => (
            <RuleCard key={item.slot.key} item={item} officeId={officeId} fileUrls={interview.fileUrls} />
          ))}
        </section>
      )}

      {questions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">A few questions</h2>
          <p className="-mt-2 text-sm text-foreground/60">Your cards didn&apos;t answer these, or said different things.</p>
          {questions.map((item) => (
            <QuestionCard key={item.slot.key} item={item} officeId={officeId} fileUrls={interview.fileUrls} />
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-foreground/10 pt-4">
        {group.confirmed ? (
          <p className="text-green-700 dark:text-green-400">This group is confirmed ✓</p>
        ) : toConfirm > 0 ? (
          <ActionButton action={confirmCardGroup.bind(null, group.slug)} label="Looks right" primary />
        ) : (
          <p className="text-sm text-foreground/70">Answer the questions above to finish this group.</p>
        )}
        <span className="flex-1" />
        {prev && (
          <Link href={`/doctor/setup/cards/${prev.slug}`} className="text-sm underline">
            ← {prev.name}
          </Link>
        )}
        <Link
          href={next ? `/doctor/setup/cards/${next.slug}` : "/doctor/setup/standards"}
          className="text-sm underline"
        >
          {next ? `${next.name} →` : "Next: VFDA standards →"}
        </Link>
      </div>
    </>
  );
}

function Source({ row }: { row: RuleRow }) {
  if (row.source !== "card_import") {
    return <p className="text-xs text-foreground/60">{row.source === "doctor" ? "Your answer" : "Entered by VFDA"}</p>;
  }
  return (
    <p className="text-xs text-foreground/60">
      From <span className="font-medium">{row.document_name ?? "your cards"}</span>
      {row.source_quote && <>: &ldquo;{row.source_quote}&rdquo;</>}
    </p>
  );
}

function RuleCard({
  item,
  officeId,
  fileUrls,
}: {
  item: Extract<CardItem, { kind: "rule" }>;
  officeId: string;
  fileUrls: Record<string, string>;
}) {
  return (
    <article id={`rule-${item.slot.key}`} className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{item.slot.question}</p>
        {item.confirmed && (
          <span className="shrink-0 text-green-700 dark:text-green-400" aria-label="Confirmed">
            ✓
          </span>
        )}
      </div>
      <div className="text-sm">
        <RuleValue slot={item.slot} value={item.row.rule} attachments={item.row.attachments} fileUrls={fileUrls} />
      </div>
      <Source row={item.row} />
      <div>
        <RuleEditor
          officeId={officeId}
          slot={item.slot}
          value={item.row.rule}
          attachments={item.row.source_document_id ? [] : item.row.attachments}
          fileUrls={fileUrls}
        />
      </div>
    </article>
  );
}

function QuestionCard({
  item,
  officeId,
  fileUrls,
}: {
  item: Extract<CardItem, { kind: "question" }>;
  officeId: string;
  fileUrls: Record<string, string>;
}) {
  // A starting point only: nothing is saved until the doctor presses Save.
  const suggestion = item.reason === "not_found" ? item.slot.suggested_answer : null;
  return (
    <article id={`rule-${item.slot.key}`} className="flex flex-col gap-2 rounded-lg border border-amber-300 p-4 dark:border-amber-700">
      <p className="font-medium">{item.slot.question}</p>
      {item.reason === "conflicting" && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-foreground/70">Your cards say different things:</p>
          {item.versions.map((v) => (
            <div key={v.id} className="rounded-md bg-foreground/5 px-3 py-2">
              <RuleValue slot={item.slot} value={v.rule} />
              <Source row={v} />
            </div>
          ))}
          <p className="text-foreground/70">Which is right? Type the rule your VA should follow.</p>
        </div>
      )}
      {suggestion && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-foreground/70">VFDA suggests:</p>
          <div className="rounded-md bg-foreground/5 px-3 py-2">
            <RuleValue slot={item.slot} value={suggestion} />
          </div>
          <p className="text-foreground/70">Save it as is, or change it to fit your office.</p>
        </div>
      )}
      <RuleEditor officeId={officeId} slot={item.slot} value={suggestion} fileUrls={fileUrls} startOpen />
    </article>
  );
}

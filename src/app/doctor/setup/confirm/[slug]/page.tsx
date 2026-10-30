import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { LockedStep } from "@/components/setup/locked-step";
import { RuleEditor } from "@/components/setup/rule-editor";
import { RuleSource } from "@/components/setup/rule-source";
import { RuleValue } from "@/components/setup/rule-value";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import type { ConfirmItem } from "@/lib/doctor-flow";
import { confirmCardGroup } from "@/lib/setup-actions";
import { loadDoctorSetup } from "../../load";

export default function ConfirmGroupPage({ params }: PageProps<"/doctor/setup/confirm/[slug]">) {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/confirm" className="text-sm text-foreground/60 hover:underline">
        ← Confirm your rules
      </Link>
      <Suspense fallback={<Loading />}>
        <ConfirmGroupScreen params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function ConfirmGroupScreen({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  if (!flow.unlocked) {
    return (
      <>
        <StepProgress steps={flow.steps} current="confirm" />
        <LockedStep />
      </>
    );
  }
  const index = flow.groups.findIndex((g) => g.slug === slug);
  if (index < 0) notFound();
  const group = flow.groups[index];
  const prev = flow.groups[index - 1];
  const next = flow.groups[index + 1];
  const toConfirm = group.items.filter((i) => i.kind === "card" && !i.confirmed).length;

  return (
    <>
      <StepProgress steps={flow.steps} current="confirm" />
      <div>
        <p className="text-sm text-foreground/60">
          Confirm your rules · {index + 1} of {flow.groups.length}
        </p>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
      </div>

      <section className="flex flex-col gap-3">
        {group.items.map((item) => (
          <RuleCard key={item.slot.key} item={item} officeId={interview.office.id} fileUrls={interview.fileUrls} />
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-foreground/10 pt-4">
        {group.confirmed ? (
          <p className="text-green-700 dark:text-green-400">This group is confirmed ✓</p>
        ) : (
          toConfirm > 0 && <ActionButton action={confirmCardGroup.bind(null, group.slug)} label="Looks right" primary />
        )}
        <span className="flex-1" />
        {prev && (
          <Link href={`/doctor/setup/confirm/${prev.slug}`} className="text-sm underline">
            ← {prev.name}
          </Link>
        )}
        <Link href={next ? `/doctor/setup/confirm/${next.slug}` : "/doctor/setup/questions"} className="text-sm underline">
          {next ? `${next.name} →` : "Next: Questions for you →"}
        </Link>
      </div>
    </>
  );
}

function RuleCard({ item, officeId, fileUrls }: { item: ConfirmItem; officeId: string; fileUrls: Record<string, string> }) {
  const done = item.kind === "answered" || item.confirmed;
  return (
    <article id={`rule-${item.slot.key}`} className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{item.slot.question}</p>
        {done && (
          <span className="shrink-0 text-green-700 dark:text-green-400" aria-label="Confirmed">
            ✓
          </span>
        )}
      </div>
      <div className="text-sm">
        <RuleValue slot={item.slot} value={item.row.rule} attachments={item.row.attachments} fileUrls={fileUrls} />
      </div>
      {item.kind === "answered" ? (
        <p className="text-xs text-foreground/60">
          {item.row.source === "doctor" ? "You answered this" : "Entered by VFDA"}
        </p>
      ) : (
        <RuleSource row={item.row} />
      )}
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

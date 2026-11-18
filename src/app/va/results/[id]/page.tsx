import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CompletedTiles, PracticeList, SkillChips } from "@/components/reports/skills";
import { StandardsNotice } from "@/components/reports/standards";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, ButtonAnchor, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";
import { startDayRetake } from "@/lib/va-actions";
import { loadMyVaReport } from "@/lib/va-reports";
import { loadRetakeTasks } from "@/lib/va-training";

export default function MyReportPage({ params }: PageProps<"/va/results/[id]">) {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <MyReport params={params} />
      </Suspense>
    </SignedInPage>
  );
}

// The VA-safe report, never a score, in order: Completed ✓ + label + "Day X
// of Y completed", Skills you showed (a checkmark list by workflow), Skills to
// practice, Important to review (only with a critical error), a small tip,
// the VFDA standards notice, an encouraging last line.
// Never the scenarios, answers or answer keys (src/lib/va-report.ts).
async function MyReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("va");
  const { id } = await params;
  const v = await loadMyVaReport(user, id, await createSessionClient());
  if (!v) notFound();
  // "Practice this day again" (optional, once) when this day may be practiced.
  const practice = user.officeId ? (await loadRetakeTasks(user.id, user.officeId)).find((t) => t.kind === "available" && t.parentId === v.attemptId) : undefined;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Today", href: "/va" },
          { label: "My results", href: "/va/results" },
          { label: `${v.dayCode}${v.topic ? ` ${v.topic}` : ""}` },
        ]}
        title="My report"
        badge={v.retake ? <Badge tone="accent">Practiced again</Badge> : undefined}
        description={
          v.ready
            ? `Nice work finishing ${v.dayCode}${v.topic ? `: ${v.topic}` : ""}! Here are the skills you showed and what to practice next.`
            : `${v.officeName} · ${new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" })}`
        }
        actions={
          <>
            {practice && <ActionButton action={startDayRetake.bind(null, v.attemptId)} label="Practice this day again" pendingLabel="Preparing (about a minute)…" />}
            <ButtonAnchor href={`/va/results/${v.attemptId}/pdf`} variant="secondary">
              Download PDF
            </ButtonAnchor>
          </>
        }
      />

      <CompletedTiles resultLabel={v.resultLabel} progress={v.progress} />

      {!v.ready ? (
        <EmptyState title="Your report is being written">Refresh this page in a few minutes.</EmptyState>
      ) : (
        <>
          <Card title="✓ Skills you showed" accent="success">
            {!v.skills.length && <p className="text-muted">You finished every question. Your skills show up here as you build them.</p>}
            <SkillChips groups={v.skills} />
            {v.highlight && <p>{v.highlight}</p>}
          </Card>

          <Card title="→ Skills to practice" description="Each one names the card to review.">
            {!v.tips.length && <p className="text-muted">Nothing this time: keep doing what you&apos;re doing.</p>}
            <PracticeList items={v.tips.map((text, n) => ({ text, tag: v.tipTags[n] ?? null }))} />
          </Card>

          {v.important.length > 0 && (
            <Notice tone="warning" title="Important to review">
              {v.important.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </Notice>
          )}

          {v.flags.length > 0 && (
            <Notice tone="neutral" title="A small tip">
              {v.flags.map((f) => (
                <p key={f}>{f}</p>
              ))}
            </Notice>
          )}
        </>
      )}

      <StandardsNotice rules={v.standards} audience="va" />

      {v.ready && <p className="text-lg font-semibold text-success">{v.closing}</p>}
    </>
  );
}

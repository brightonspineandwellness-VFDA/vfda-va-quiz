import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TipList } from "@/components/attempts/va-tips";
import { StandardsNotice } from "@/components/reports/standards";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ButtonAnchor, Card, EmptyState, Notice, PageHeader, StatTile, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { minutesText } from "@/lib/report";
import { createSessionClient } from "@/lib/supabase/server";
import { toneOf } from "@/lib/theme";
import { loadMyVaReport } from "@/lib/va-reports";

export default function MyReportPage({ params }: PageProps<"/va/results/[id]">) {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <MyReport params={params} />
      </Suspense>
    </SignedInPage>
  );
}

// The VA-safe report, in order: score + label, What went well (grouped by
// workflow), Things to focus on, Important to review (only with a critical
// error), gentle flags, the VFDA standards notice, an encouraging last line.
// Never the scenarios, answers or answer keys (src/lib/va-report.ts).
async function MyReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("va");
  const { id } = await params;
  const v = await loadMyVaReport(user, id, await createSessionClient());
  if (!v) notFound();

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Today", href: "/va" },
          { label: "My results", href: "/va/results" },
          { label: `${v.dayCode}${v.retake ? " retake" : ""}` },
        ]}
        title={`${v.dayCode}${v.topic ? `: ${v.topic}` : ""}`}
        badge={v.retake ? <StatusBadge label="Retake" /> : undefined}
        description={`${v.officeName} · ${new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" })}`}
        actions={
          <ButtonAnchor href={`/va/results/${v.attemptId}/pdf`} variant="secondary">
            Download PDF
          </ButtonAnchor>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Result" value={<StatusBadge label={v.resultLabel} size="lg" />} />
        <StatTile label={v.retake ? "Retake score" : "Score"} value={v.score} tone="primary" />
        {v.otherScore ? <StatTile label={v.otherScore.caption} value={v.otherScore.text} tone="accent" /> : <StatTile label="Time spent" value={minutesText(v.timeSpent)} />}
      </div>

      {!v.ready ? (
        <EmptyState title="Your report is being written">Refresh this page in a few minutes.</EmptyState>
      ) : (
        <>
          <Card title="What went well" accent={toneOf("Great work")}>
            {!v.wentWell.length && <p className="text-muted">You finished every question. Your strengths show up here as you build them.</p>}
            <div className="flex flex-col gap-4">
              {v.wentWell.map((g, n) => (
                <div key={`${g.name}-${n}`} className="flex flex-col gap-1">
                  {g.name && <p className="font-semibold">{g.name}</p>}
                  <ul className="flex list-disc flex-col gap-1.5 pl-5">
                    {g.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Things to focus on" description="Each one names the card to review.">
            {!v.tips.length && <p className="text-muted">Nothing this time: keep doing what you&apos;re doing.</p>}
            <TipList tips={v.tips} tags={v.tipTags} />
          </Card>

          {v.important.length > 0 && (
            <Notice tone="warning" title="Important to review">
              <ul className="list-disc pl-5">
                {v.important.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Notice>
          )}

          {v.flags.length > 0 && (
            <Notice tone="neutral" title="Keep in mind">
              <ul className="list-disc pl-5">
                {v.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Notice>
          )}
        </>
      )}

      <StandardsNotice rules={v.standards} audience="va" />

      {v.ready && <p className="text-lg font-semibold text-success">{v.closing}</p>}
    </>
  );
}

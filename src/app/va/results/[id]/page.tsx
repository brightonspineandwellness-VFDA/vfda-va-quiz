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
import { loadMyVaReport, trendLine } from "@/lib/va-reports";

export default function MyReportPage({ params }: PageProps<"/va/results/[id]">) {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <MyReport params={params} />
      </Suspense>
    </SignedInPage>
  );
}

// The VA-safe report: header, alerts in general terms, the VFDA standards
// notice, trend, coaching tips. Never the scenarios, answers or answer keys
// (src/lib/va-report.ts).
async function MyReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("va");
  const { id } = await params;
  const v = await loadMyVaReport(user, id, await createSessionClient());
  if (!v) notFound();
  const max = Math.max(100, ...v.trend.rows.map((r) => r.percent));

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={v.retake ? "Retake score" : "First-try score"} value={`${v.percent}%`} tone="primary" />
        <StatTile label="Result" value={<StatusBadge label={v.resultLabel} size="lg" />} />
        <StatTile label="Time spent" value={minutesText(v.timeSpent)} />
        {v.retakePercent !== null && <StatTile label="Retake" value={`${v.retakePercent}%`} tone="accent" />}
        {v.firstTryPercent !== null && <StatTile label="First try was" value={`${v.firstTryPercent}%`} />}
      </div>

      {!v.alerts.length && !v.flags.length ? (
        <Notice tone="neutral" title="Alerts">
          <p className="text-muted">No critical errors or flags.</p>
        </Notice>
      ) : (
        <Notice tone={v.alerts.length ? "danger" : "warning"} title="Alerts" role="alert">
          {v.alerts.length > 0 && (
            <>
              <p className="font-semibold text-danger">Critical errors</p>
              <ul className="list-disc pl-5 text-danger">
                {v.alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          )}
          {v.flags.length > 0 && (
            <>
              <p className="font-semibold">Flags</p>
              <ul className="list-disc pl-5">
                {v.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
        </Notice>
      )}

      <StandardsNotice rules={v.standards} audience="va" />

      <Card title="Trend">
        <ul className="flex flex-col gap-2 text-[0.9375rem]">
          {v.trend.rows.map((r) => (
            <li key={r.day} className="grid grid-cols-[3.5rem_1fr_5.5rem] items-center gap-3">
              <span className={r.current ? "font-semibold" : ""}>{r.day}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-surface-muted">
                <span className={`block h-2.5 rounded-full ${r.current ? "bg-primary" : "bg-success"}`} style={{ width: `${(Math.min(r.percent, max) * 100) / max}%` }} />
              </span>
              <span className={`text-right tabular-nums ${r.current ? "font-semibold" : ""}`}>
                {r.percent}%{r.current && " (this)"}
              </span>
            </li>
          ))}
        </ul>
        <p className="font-medium">{trendLine(v)}</p>
      </Card>

      <Card title="Coaching tips" description="Most important first. Each tip names the card to review.">
        {!v.ready ? (
          <EmptyState title="Your coaching tips are being written">Refresh this page in a few minutes.</EmptyState>
        ) : (
          <>
            {!v.tips.length && <p className="text-muted">Nothing to fix: every question got full points.</p>}
            <TipList tips={v.tips} tags={v.tipTags} />
          </>
        )}
      </Card>

      {v.ready && v.strengths.length > 0 && (
        <Card title="What you did well" accent={toneOf("Strong")}>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            {v.strengths.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { minutesText } from "@/lib/report";
import { createSessionClient } from "@/lib/supabase/server";
import { loadMyVaReport, trendLine } from "@/lib/va-reports";

export default function MyReportPage({ params }: PageProps<"/va/results/[id]">) {
  return (
    <SignedInPage area="VA">
      <Link href="/va/results" className="text-sm text-foreground/60 hover:underline">
        ← My results
      </Link>
      <Suspense fallback={<Loading />}>
        <MyReport params={params} />
      </Suspense>
    </SignedInPage>
  );
}

// The VA-safe report: header, alerts in general terms, trend, coaching tips.
// Never the scenarios, answers or answer keys (src/lib/va-report.ts).
async function MyReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("va");
  const { id } = await params;
  const v = await loadMyVaReport(user, id, await createSessionClient());
  if (!v) notFound();
  const max = Math.max(100, ...v.trend.rows.map((r) => r.percent));

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {v.dayCode}
          {v.topic && `: ${v.topic}`}
          {v.retake && <span className="ml-2 rounded bg-blue-700 px-2 py-0.5 align-middle text-xs font-semibold text-white">RETAKE</span>}
        </h1>
        <p className="text-sm text-foreground/60">{new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="font-medium">
            {v.retake ? "Retake score" : "First-try score"}: {v.percent}%
          </span>
          <span>{v.resultLabel}</span>
          <span>Time spent: {minutesText(v.timeSpent)}</span>
          {v.retakePercent !== null && <span>Retake: {v.retakePercent}%</span>}
          {v.firstTryPercent !== null && <span>First try was {v.firstTryPercent}%</span>}
        </p>
        <a
          href={`/va/results/${v.attemptId}/pdf`}
          className="mt-2 self-start rounded-lg border border-foreground/25 px-4 py-2 text-sm font-medium hover:bg-foreground/5"
        >
          Download PDF
        </a>
      </header>

      <section
        className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${v.alerts.length ? "border-red-700/60 bg-red-50 dark:bg-red-950/30" : "border-foreground/15"}`}
      >
        <h2 className="text-lg font-semibold">Alerts</h2>
        {!v.alerts.length && !v.flags.length && <p className="text-sm text-foreground/70">No critical errors or flags.</p>}
        {v.alerts.length > 0 && (
          <>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">Critical errors</p>
            <ul className="list-disc pl-5 text-sm text-red-800 dark:text-red-300">
              {v.alerts.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        )}
        {v.flags.length > 0 && (
          <>
            <p className="text-sm font-semibold">Flags</p>
            <ul className="list-disc pl-5 text-sm">
              {v.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Trend</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {v.trend.rows.map((r) => (
            <li key={r.day} className="grid grid-cols-[3.5rem_1fr_5.5rem] items-center gap-2">
              <span className={r.current ? "font-semibold" : ""}>{r.day}</span>
              <span className="h-2.5 rounded bg-foreground/10">
                <span
                  className={`block h-2.5 rounded ${r.current ? "bg-blue-700" : "bg-green-700"}`}
                  style={{ width: `${(Math.min(r.percent, max) * 100) / max}%` }}
                />
              </span>
              <span className={r.current ? "font-semibold" : ""}>
                {r.percent}%{r.current && " (this)"}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm font-medium">{trendLine(v)}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Coaching tips</h2>
        {!v.ready ? (
          <p className="text-sm text-foreground/70">Your coaching tips are being written. Refresh in a few minutes.</p>
        ) : (
          <>
            {!v.tips.length && <p className="text-sm text-foreground/70">Nothing to fix: every question got full points.</p>}
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
              {v.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            {v.strengths.length > 0 && (
              <>
                <p className="mt-2 text-sm font-semibold text-green-800 dark:text-green-300">What you did well</p>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
                  {v.strengths.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}

// A Call practice report in the app, laid out like the quiz report: the
// label and counts, Skills shown, Skills to practice, Important to review,
// flags, and (doctor / VFDA) coaching ideas. A PDF of the same is linked.

import Link from "next/link";
import { Badge, ButtonAnchor, Card, EmptyState, linkClass, Notice, resultToneOf } from "@/components/calls/report-bits";
import type { CallReportContent, CallReportRow } from "@/lib/call-practice/report";
import { reportTitle } from "@/lib/call-practice/report";

const day = (iso: string, timeZone: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });

export function CallReportView({ id, r, timeZone, audience }: { id: string; r: CallReportContent; timeZone: string; audience: "va" | "staff" }) {
  const first = r.vaName.trim().split(/\s+/)[0] || "your VA";
  const you = audience === "va";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-muted">
        {!you && <span className="font-medium text-foreground">{r.vaName}</span>}
        <span>{r.officeName}</span>
        <span>
          · {day(r.from, timeZone)} – {day(r.to, timeZone)}
        </span>
        <Badge tone={resultToneOf(r.label)} size="lg">
          {r.label}
        </Badge>
        <ButtonAnchor href={`/api/calls/reports/${id}/pdf`} target="_blank" rel="noopener" size="sm">
          Open PDF
        </ButtonAnchor>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <span className="text-sm text-muted">These 10 calls</span>
          <span className="text-2xl font-semibold tabular-nums">
            {r.stats.passed} of {r.stats.calls} passed
          </span>
          <span className="text-sm text-muted">
            {r.stats.easy} easy · {r.stats.challenging} challenging
          </span>
        </Card>
        <Card>
          <span className="text-sm text-muted">Easy calls</span>
          <span className="text-2xl font-semibold tabular-nums">
            {r.progress.easy} of {r.progress.goal}
          </span>
        </Card>
        <Card>
          <span className="text-sm text-muted">Challenging calls</span>
          <span className="text-2xl font-semibold tabular-nums">
            {r.progress.challenging} of {r.progress.goal}
          </span>
        </Card>
      </div>
      {r.summary && <p className="text-[1.0625rem]">{r.summary}</p>}

      <Card title={you ? "Skills you showed" : `Skills ${first} showed`} accent="success">
        {!r.skills.length ? (
          <p className="text-muted">Skills show up here as they build.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {r.skills.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-success" aria-hidden>
                  ✓
                </span>
                {s}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Skills to practice">
        {!r.practice.length ? (
          <p className="text-muted">Nothing this time: keep doing what you&apos;re doing.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {r.practice.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1">{p.text}</span>
                {p.source && <Badge tone={p.source === "VFDA standard" ? "info" : "neutral"}>{p.source}</Badge>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {!!r.important.length && (
        <Notice tone="warning" title="Important to review">
          {r.important.map((i, n) => (
            <div key={n}>
              <p>&ldquo;{i.quote}&rdquo;</p>
              <p className="text-sm text-muted">{i.why}</p>
            </div>
          ))}
        </Notice>
      )}
      {!!r.flags.length && (
        <Notice tone="neutral" title="Flags">
          {r.flags.map((f, i) => (
            <p key={i}>{f}</p>
          ))}
        </Notice>
      )}
      {!you && !!r.coaching.length && (
        <Card title={`Coaching ideas for ${first}`} description="For the doctor and VFDA. The VA's copy doesn't include these.">
          <ul className="list-disc space-y-1.5 pl-5">
            {r.coaching.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// The list of reports, newest first.
export function CallReportList({
  reports,
  linkBase,
  names,
  timeZone,
}: {
  reports: CallReportRow[];
  linkBase: string;
  names?: Map<string, string>;
  timeZone: string;
}) {
  return (
    <Card title="Call practice reports" description="A report is made after every 10 practice calls.">
      {!reports.length ? (
        <EmptyState title="No reports yet">The first report comes after 10 practice calls.</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <Link href={`${linkBase}/${r.id}`} className={linkClass}>
                  {names ? `${names.get(r.va_id) ?? "VA"}: ` : ""}
                  {reportTitle(r.content)}
                </Link>
                <span className="block text-sm text-muted">
                  {day(r.content.to, timeZone)} · {r.content.stats.passed} of {r.content.stats.calls} passed
                </span>
              </span>
              <Badge tone={resultToneOf(r.content.label)}>{r.content.label}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

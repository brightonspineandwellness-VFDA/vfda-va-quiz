import Link from "next/link";
import { OverrideForm } from "@/components/attempts/override-form";
import { StandardsNotice } from "@/components/reports/standards";
import { TestButton } from "@/components/settings/test-button";
import { ActionButton } from "@/components/setup/action-button";
import { Badge, ButtonAnchor, Card, Notice, PageHeader, StatusBadge, type Crumb } from "@/components/ui";
import { RetakeCompare } from "@/components/va/retake-compare";
import { ITEM_TYPE_LABELS } from "@/lib/day-rules";
import type { AttemptReviewData, ReviewAnswer, ReviewItem } from "@/lib/attempt-review";
import { minutesText } from "@/lib/report";
import type { RetakeComparison } from "@/lib/retake";
import { regradeAttemptAction, resendAttemptReport, sendReportAgain } from "@/lib/va-admin-actions";
import { attemptLabel, oldLabelHint, percentOf, resultLabel } from "@/lib/va-flow";

// One attempt, item by item. `admin` adds score overrides (they change only
// the label) and the report status; the doctor's view is read-only.
// `standards`: the VFDA standard rules the attempt relied on (the notice).
export function AttemptReview({
  data,
  admin,
  standards = [],
  breadcrumbs,
}: {
  data: AttemptReviewData;
  admin: boolean;
  standards?: string[];
  breadcrumbs?: Crumb[];
}) {
  const { attempt, items } = data;
  const drill = attempt.kind === "retrain" ? "Retrain" : attempt.kind === "recheck" ? "Recheck" : null;
  const workflow = items[0]?.workflow ?? "";

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={`${data.vaName}: ${drill ? `${drill} ${workflow}` : attemptLabel(attempt)}`}
        badge={attempt.kind === "retake" ? <StatusBadge label="Retake" /> : undefined}
        description={
          <>
            {data.officeName}
            {!drill && data.day?.title && ` · ${data.day.title}`}
          </>
        }
      />

      <Card title="Summary">
        <Summary data={data} admin={admin} />
      </Card>
      <StandardsNotice rules={standards} audience="doctor" />
      <p className="text-sm text-muted">Labels never block: the VA saw their score and feedback and moved on. Changing a score changes only the label.</p>

      <ol className="flex flex-col gap-4">
        {items.map((item, n) => (
          <li key={item.id}>
            <Item item={item} admin={admin} number={n + 1} />
          </li>
        ))}
      </ol>
    </>
  );
}

// A day and its retake side by side: both summaries, every question's
// first-try and retake score (missed the first time highlighted), then each
// question's two answers next to each other. The first try stays official.
export function RetakeReview({
  first,
  retake,
  comparison,
  admin,
  standards = {},
  breadcrumbs,
}: {
  first: AttemptReviewData;
  retake: AttemptReviewData;
  comparison: RetakeComparison;
  admin: boolean;
  // Each attempt's VFDA standard rules, by attempt id (the notice).
  standards?: Record<string, string[]>;
  breadcrumbs?: Crumb[];
}) {
  const retakeOf = (item: ReviewItem) => retake.items.find((r) => r.first.scenario?.parent_scenario_id === item.first.scenario?.id) ?? null;
  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={`${first.vaName}: ${first.attempt.schedule_day} and its retake`}
        description={
          <>
            {first.officeName}
            {first.day?.title && ` · ${first.day.title}`}
          </>
        }
      />
      <RetakeCompare data={comparison} />
      <p className="text-sm text-muted">
        The first try is the official score (certification uses it); the retake is shown as improvement. Changing a score changes only that attempt&apos;s
        label.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="First try (official)">
          <Summary data={first} admin={admin} />
          <StandardsNotice rules={standards[first.attempt.id] ?? []} audience="doctor" />
        </Card>
        <Card title="Retake" accent="accent">
          <Summary data={retake} admin={admin} />
          <StandardsNotice rules={standards[retake.attempt.id] ?? []} audience="doctor" />
        </Card>
      </div>
      <ol className="flex flex-col gap-4">
        {first.items.map((item) => {
          const again = retakeOf(item);
          const missed = item.first.score === null || item.first.score < item.points;
          return (
            <li key={item.id} className="flex flex-col gap-2">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {item.code}
                {missed && <Badge tone="warning">Missed the first time</Badge>}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Item item={item} admin={admin} heading="First try" />
                {again ? <Item item={again} admin={admin} heading="Retake" /> : <p className="text-sm text-muted">Not answered on the retake yet.</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

// An attempt's label, score, repeats, time and flags, and (admin) where its report went.
function Summary({ data, admin }: { data: AttemptReviewData; admin: boolean }) {
  const { attempt, items } = data;
  const repeats = items.filter((i) => i.repeat);
  const alerts = data.notifications.filter((n) => n.event.startsWith("critical") && n.status === "sent");
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.9375rem]">
        <dt className="text-muted">Label</dt>
        <dd>
          {attempt.submitted_at ? (
            <StatusBadge label={resultLabel(attempt.result)} hint={admin ? oldLabelHint(attempt.result) : undefined} />
          ) : (
            <StatusBadge label="Not finished" tone="neutral" />
          )}
        </dd>
        <dt className="text-muted">{attempt.kind === "retake" ? "Score" : "First try"}</dt>
        <dd className="font-semibold tabular-nums">
          {attempt.first_try_points === null
            ? "–"
            : `${Number(attempt.first_try_points)}/${attempt.max_points} (${percentOf(attempt.first_try_points, attempt.max_points)}%)`}
        </dd>
        <dt className="text-muted">Repeat scores</dt>
        <dd>{repeats.length ? repeats.map((i) => `${i.code} ${i.first.score ?? "–"}→${i.repeat?.score ?? "–"}`).join(", ") : "none"}</dd>
        <dt className="text-muted">Time spent</dt>
        <dd>{minutesText(attempt.time_spent)}</dd>
        <dt className="text-muted">Flags</dt>
        <dd>
          {[
            attempt.fast_finish && "finished much faster than normal",
            Array.isArray(attempt.paste_log) && attempt.paste_log.length > 0 && `${attempt.paste_log.length} paste(s) logged`,
            attempt.critical_errors > 0 && `${attempt.critical_errors} critical error(s)`,
          ]
            .filter(Boolean)
            .join(", ") || "–"}
        </dd>
      </dl>
      {attempt.submitted_at && <ReportPdfLink attemptId={attempt.id} area={admin ? "admin" : "doctor"} />}
      {admin && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <ReportStatus attemptId={attempt.id} rows={data.notifications.filter((n) => n.event === "")} />
          {attempt.submitted_at && <SendAgain attemptId={attempt.id} rows={data.notifications.filter((n) => n.event.startsWith("again:"))} />}
          {attempt.submitted_at && (
            <div className="flex flex-col gap-1 text-sm">
              <TestButton action={regradeAttemptAction.bind(null, attempt.id)} label="Re-grade with new rubric" pendingLabel="Re-grading…" />
              <span className="text-muted">Scores the written answers again, rebuilds the VA report and the PDF. No emails or posts.</span>
            </div>
          )}
          {alerts.length > 0 && <p className="text-sm text-muted">Critical error alert sent to {[...new Set(alerts.map((n) => n.recipient))].join(", ")}</p>}
        </div>
      )}
    </>
  );
}

function scoreText(score: number | null, max: number) {
  return score === null ? "needs review" : `${score}/${max}`;
}

function Item({ item, admin, heading, number }: { item: ReviewItem; admin: boolean; heading?: string; number?: number }) {
  const max = item.type === "mc" ? item.points : 2;
  const o = item.override;
  return (
    <Card
      as="div"
      number={number}
      headingAs="h3"
      accent={item.criticalError ? "danger" : undefined}
      title={heading ?? item.code}
      description={
        <>
          {item.workflow} · {ITEM_TYPE_LABELS[item.type]}
          {item.seconds !== null && ` · ${Math.max(1, Math.round(item.seconds / 60))} min`}
        </>
      }
      actions={
        <span className="flex flex-wrap gap-1">
          {item.criticalError && <Badge tone="danger">Critical error</Badge>}
          {item.needsReview && <Badge tone="warning">Needs review</Badge>}
          {item.type !== "mc" && item.confidence !== null && item.confidence < 0.7 && !o && <Badge tone="warning">Low confidence</Badge>}
          {item.fast && <Badge tone="warning">Fast</Badge>}
          {item.pastes > 0 && <Badge tone="warning">{item.pastes} paste(s)</Badge>}
        </span>
      }
    >
      <Answer title="First try" answer={item.first} max={max} />
      {item.repeat && <Answer title="Repeat" answer={item.repeat} max={max} />}
      {item.criticalError && item.criticalQuote && (
        <Notice tone="danger">
          <p>
            <span className="font-semibold text-danger">Critical, in the VA&apos;s words: </span>“{item.criticalQuote}”
          </p>
        </Notice>
      )}

      {o && (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface-muted px-3 py-2 text-sm">
          <span className="font-medium">VFDA override:</span> first try {scoreText(o.first_score, max)}
          {o.repeat_score !== null && `, repeat ${scoreText(o.repeat_score, max)}`}
          {o.critical_error ? ", critical error" : ", no critical error"}. “{o.note}” ({o.by}, {new Date(o.at).toLocaleDateString("en-US")})
        </p>
      )}
      {admin && (
        <OverrideForm
          itemId={item.id}
          max={max}
          first={o?.first_score ?? item.first.score}
          repeat={item.repeat ? (o?.repeat_score ?? item.repeat.score) : undefined}
          critical={o ? o.critical_error : item.criticalError}
        />
      )}
    </Card>
  );
}

function Answer({ title, answer, max }: { title: string; answer: ReviewAnswer; max: number }) {
  const tone = !answer.parts.length || answer.score === null ? "neutral" : answer.score >= max ? "success" : answer.score > 0 ? "warning" : "danger";
  return (
    <div className="flex flex-col gap-2 text-[0.9375rem]">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{title}</span>
        <Badge tone={tone}>{answer.parts.length ? scoreText(answer.score, max) : "not answered yet"}</Badge>
      </p>
      {answer.scenario && (
        <details className="rounded-[var(--radius-card)] border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-primary">Scenario</summary>
          <p className="mt-2 whitespace-pre-wrap">{answer.scenario.stem}</p>
        </details>
      )}
      {answer.parts.map((p) => (
        <div key={p.label}>
          <p className="text-sm font-semibold text-muted">{p.label}</p>
          <p className="whitespace-pre-wrap">{p.text.trim() || "(left empty)"}</p>
        </div>
      ))}
      {answer.reason && <p>{answer.reason}</p>}
      {answer.missedSteps.length > 0 && (
        <ul className="list-disc pl-5">
          {answer.missedSteps.map((m) => (
            <li key={m}>Missed: {m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

type NoteRow = AttemptReviewData["notifications"][number];

// "Send report": the PDF made again and everything sent again; the last such send's outcome.
function SendAgain({ attemptId, rows }: { attemptId: string; rows: Pick<NoteRow, "channel" | "recipient" | "status" | "error" | "event">[] }) {
  const last = rows
    .map((r) => r.event)
    .sort()
    .at(-1);
  const mine = rows.filter((r) => r.event === last);
  const sent = mine.filter((r) => r.status === "sent");
  const failed = mine.filter((r) => r.status === "failed");
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton action={sendReportAgain.bind(null, attemptId)} label="Send report" pendingLabel="Sending…" />
        <span className="text-muted">Makes the PDF again and sends it to VFDA, Slack and Leads4Life.</span>
      </div>
      {last && (
        <span>
          Sent again {new Date(last.slice("again:".length)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          {sent.length > 0 && ` to ${sent.map(where).join(", ")}`}
        </span>
      )}
      {failed.map((r) => (
        <span key={`${r.channel}:${r.recipient}`} className="font-medium text-danger">
          {where(r)}: {r.error ?? "not sent"}
        </span>
      ))}
    </div>
  );
}

// "Download report PDF": the attempt's quiz report (made the first time it's asked for).
export function ReportPdfLink({ attemptId, area }: { attemptId: string; area: "admin" | "doctor" }) {
  return (
    <ButtonAnchor href={`/${area}/attempts/${attemptId}/report-pdf`} size="sm" className="self-start">
      Download report PDF
    </ButtonAnchor>
  );
}

const LEADS4LIFE = "leads4life";
const where = (r: Pick<NoteRow, "channel" | "recipient">) => (r.channel === LEADS4LIFE ? `Leads4Life (${r.recipient})` : r.recipient);

// Where the report went (VFDA email and Slack, Leads4Life per doctor); a red
// "report not sent" or "Leads4Life not sent" badge and "Resend" when any part didn't.
export function ReportStatus({ attemptId, rows }: { attemptId: string; rows: Pick<NoteRow, "channel" | "recipient" | "status" | "error">[] }) {
  const sent = rows.filter((r) => r.status === "sent");
  const failed = rows.filter((r) => r.status === "failed");
  const pending = rows.filter((r) => r.status === "pending");
  const leadsFailed = failed.some((r) => r.channel === LEADS4LIFE);
  const otherFailed = failed.some((r) => r.channel !== LEADS4LIFE);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {(otherFailed || rows.length === 0) && <Badge tone="danger">Report not sent</Badge>}
        {leadsFailed && <Badge tone="danger">Leads4Life not sent</Badge>}
        {sent.length > 0 && <span>Report sent to {sent.map(where).join(", ")}</span>}
        {pending.length > 0 && <span className="text-muted">sending to {pending.map(where).join(", ")}…</span>}
        {(failed.length > 0 || rows.length === 0) && <ActionButton action={resendAttemptReport.bind(null, attemptId)} label="Resend" pendingLabel="Sending…" />}
      </div>
      {failed.map((r) => (
        <span key={`${r.channel}:${r.recipient}`} className="font-medium text-danger">
          {where(r)}: {r.error ?? "not sent"}
        </span>
      ))}
    </div>
  );
}

export function AttemptLink({ id, area }: { id: string; area: "admin" | "doctor" }) {
  return (
    <Link href={`/${area}/attempts/${id}`} className="font-medium text-primary hover:underline">
      Review
    </Link>
  );
}

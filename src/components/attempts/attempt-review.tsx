import Link from "next/link";
import type { ReactNode } from "react";
import { OverrideForm } from "@/components/attempts/override-form";
import { ActionButton } from "@/components/setup/action-button";
import { RetakeCompare } from "@/components/va/retake-compare";
import { ITEM_TYPE_LABELS } from "@/lib/day-rules";
import type { AttemptReviewData, ReviewAnswer, ReviewItem } from "@/lib/attempt-review";
import { minutesText } from "@/lib/report";
import type { RetakeComparison } from "@/lib/retake";
import { resendAttemptReport } from "@/lib/va-admin-actions";
import { attemptLabel, percentOf, resultLabel } from "@/lib/va-flow";

const LABEL_TONE: Record<string, string> = {
  strong: "text-green-700 dark:text-green-400",
  needs_coaching: "text-amber-700 dark:text-amber-300",
  at_risk: "text-red-700 dark:text-red-400",
};

// One attempt, item by item. `admin` adds score overrides (they change only
// the label) and the report status; the doctor's view is read-only.
export function AttemptReview({ data, admin }: { data: AttemptReviewData; admin: boolean }) {
  const { attempt, items } = data;
  const drill = attempt.kind === "retrain" ? "Retrain" : attempt.kind === "recheck" ? "Recheck" : null;
  const workflow = items[0]?.workflow ?? "";

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {data.vaName}: {drill ? `${drill} ${workflow}` : attemptLabel(attempt)}
        </h1>
        <p className="text-sm text-foreground/60">
          {data.officeName}
          {!drill && data.day?.title && ` · ${data.day.title}`}
        </p>
      </div>

      <Summary data={data} admin={admin} />
      <p className="text-sm text-foreground/60">
        Labels never block: the VA saw their score and feedback and moved on. Changing a score changes only the label.
      </p>

      <ol className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.id}>
            <Item item={item} admin={admin} />
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
}: {
  first: AttemptReviewData;
  retake: AttemptReviewData;
  comparison: RetakeComparison;
  admin: boolean;
}) {
  const retakeOf = (item: ReviewItem) => retake.items.find((r) => r.first.scenario?.parent_scenario_id === item.first.scenario?.id) ?? null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {first.vaName}: {first.attempt.schedule_day} and its retake
        </h1>
        <p className="text-sm text-foreground/60">
          {first.officeName}
          {first.day?.title && ` · ${first.day.title}`}
        </p>
      </div>
      <RetakeCompare data={comparison} />
      <p className="text-sm text-foreground/60">
        The first try is the official score (certification uses it); the retake is shown as improvement. Changing a score
        changes only that attempt&apos;s label.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-3">
          <h2 className="font-semibold">First try (official)</h2>
          <Summary data={first} admin={admin} />
        </section>
        <section className="flex flex-col gap-2 rounded-lg border border-blue-300 p-3 dark:border-blue-800">
          <h2 className="font-semibold">Retake</h2>
          <Summary data={retake} admin={admin} />
        </section>
      </div>
      <ol className="flex flex-col gap-4">
        {first.items.map((item) => {
          const again = retakeOf(item);
          const missed = item.first.score === null || item.first.score < item.points;
          return (
            <li key={item.id} className="flex flex-col gap-2">
              <p className={`text-sm font-semibold ${missed ? "text-amber-700 dark:text-amber-300" : ""}`}>
                {item.code}
                {missed && " · missed the first time"}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Item item={item} admin={admin} heading="First try" />
                {again ? <Item item={again} admin={admin} heading="Retake" /> : <p className="text-sm text-foreground/60">Not answered on the retake yet.</p>}
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
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-foreground/60">Label</dt>
        <dd className={`font-medium ${LABEL_TONE[attempt.result ?? ""] ?? ""}`}>
          {attempt.submitted_at ? resultLabel(attempt.result) : "not finished"}
        </dd>
        <dt className="text-foreground/60">{attempt.kind === "retake" ? "Score" : "First try"}</dt>
        <dd className="font-medium">
          {attempt.first_try_points === null
            ? "–"
            : `${Number(attempt.first_try_points)}/${attempt.max_points} (${percentOf(attempt.first_try_points, attempt.max_points)}%)`}
        </dd>
        <dt className="text-foreground/60">Repeat scores</dt>
        <dd>
          {repeats.length
            ? repeats.map((i) => `${i.code} ${i.first.score ?? "–"}→${i.repeat?.score ?? "–"}`).join(", ")
            : "none"}
        </dd>
        <dt className="text-foreground/60">Time spent</dt>
        <dd>{minutesText(attempt.time_spent)}</dd>
        <dt className="text-foreground/60">Flags</dt>
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
        <div className="flex flex-col gap-1">
          <ReportStatus attemptId={attempt.id} rows={data.notifications.filter((n) => n.event === "")} />
          {alerts.length > 0 && (
            <p className="text-sm">Critical error alert sent to {[...new Set(alerts.map((n) => n.recipient))].join(", ")}</p>
          )}
        </div>
      )}
    </>
  );
}

function scoreText(score: number | null, max: number) {
  return score === null ? "needs review" : `${score}/${max}`;
}

function Item({ item, admin, heading }: { item: ReviewItem; admin: boolean; heading?: string }) {
  const max = item.type === "mc" ? item.points : 2;
  const o = item.override;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{heading ?? item.code}</span>
        <span className="text-sm text-foreground/60">
          {item.workflow} · {ITEM_TYPE_LABELS[item.type]}
          {item.seconds !== null && ` · ${Math.max(1, Math.round(item.seconds / 60))} min`}
        </span>
        <span className="flex flex-wrap gap-1 text-xs">
          {item.criticalError && <Badge tone="red">critical error</Badge>}
          {item.needsReview && <Badge tone="amber">needs review</Badge>}
          {item.type !== "mc" && item.confidence !== null && item.confidence < 0.7 && !o && (
            <Badge tone="amber">low confidence</Badge>
          )}
          {item.fast && <Badge tone="amber">fast</Badge>}
          {item.pastes > 0 && <Badge tone="amber">{item.pastes} paste(s)</Badge>}
        </span>
      </div>

      <Answer title="First try" answer={item.first} max={max} />
      {item.repeat && <Answer title="Repeat" answer={item.repeat} max={max} />}
      {item.criticalError && item.criticalQuote && (
        <p className="text-sm">
          <span className="font-medium text-red-700 dark:text-red-400">Critical, in the VA&apos;s words: </span>“
          {item.criticalQuote}”
        </p>
      )}

      {o && (
        <p className="rounded-lg bg-foreground/5 px-3 py-2 text-sm">
          <span className="font-medium">VFDA override:</span> first try {scoreText(o.first_score, max)}
          {o.repeat_score !== null && `, repeat ${scoreText(o.repeat_score, max)}`}
          {o.critical_error ? ", critical error" : ", no critical error"}. “{o.note}” ({o.by},{" "}
          {new Date(o.at).toLocaleDateString("en-US")})
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
    </div>
  );
}

function Answer({ title, answer, max }: { title: string; answer: ReviewAnswer; max: number }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        <span className="font-medium">{title}: </span>
        {answer.parts.length ? scoreText(answer.score, max) : "not answered yet"}
      </p>
      {answer.scenario && (
        <details>
          <summary className="cursor-pointer text-foreground/60">Scenario</summary>
          <p className="mt-1 whitespace-pre-wrap">{answer.scenario.stem}</p>
        </details>
      )}
      {answer.parts.map((p) => (
        <div key={p.label}>
          <p className="text-foreground/60">{p.label}</p>
          <p className="whitespace-pre-wrap">{p.text.trim() || "(left empty)"}</p>
        </div>
      ))}
      {answer.reason && <p className="text-foreground/80">{answer.reason}</p>}
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

function Badge({ tone, children }: { tone: "red" | "amber"; children: ReactNode }) {
  const color =
    tone === "red"
      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return <span className={`rounded px-1.5 py-0.5 font-medium ${color}`}>{children}</span>;
}

type NoteRow = AttemptReviewData["notifications"][number];

// "Download report PDF": the attempt's quiz report (made the first time it's asked for).
export function ReportPdfLink({ attemptId, area }: { attemptId: string; area: "admin" | "doctor" }) {
  return (
    <a href={`/${area}/attempts/${attemptId}/report-pdf`} className="self-start rounded-md border border-foreground/20 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5">
      Download report PDF
    </a>
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
        {(otherFailed || rows.length === 0) && <Badge tone="red">report not sent</Badge>}
        {leadsFailed && <Badge tone="red">Leads4Life not sent</Badge>}
        {sent.length > 0 && <span>Report sent to {sent.map(where).join(", ")}</span>}
        {pending.length > 0 && <span className="text-foreground/60">sending to {pending.map(where).join(", ")}…</span>}
        {(failed.length > 0 || rows.length === 0) && (
          <ActionButton action={resendAttemptReport.bind(null, attemptId)} label="Resend" pendingLabel="Sending…" />
        )}
      </div>
      {failed.map((r) => (
        <span key={`${r.channel}:${r.recipient}`} className="text-red-700 dark:text-red-400">
          {where(r)}: {r.error ?? "not sent"}
        </span>
      ))}
    </div>
  );
}

export function AttemptLink({ id, area }: { id: string; area: "admin" | "doctor" }) {
  return (
    <Link href={`/${area}/attempts/${id}`} className="underline">
      Review
    </Link>
  );
}

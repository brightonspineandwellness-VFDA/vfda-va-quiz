import Link from "next/link";
import type { ReactNode } from "react";
import { OverrideForm } from "@/components/attempts/override-form";
import { ActionButton } from "@/components/setup/action-button";
import type { AttemptReviewData, ReviewAnswer, ReviewItem } from "@/lib/attempt-review";
import { minutesText, RESULT_LABELS } from "@/lib/report";
import { decideAttempt, releaseFeedback, resendAttemptReport } from "@/lib/va-admin-actions";
import { showDate } from "@/lib/va-flow";

const UNLOCK_LABELS: Record<string, string> = {
  open: "open",
  passed: "passed (next day can open)",
  in_review: "waiting for VFDA's decision",
  retake: "retake assigned (version B)",
  locked: "locked",
};

// One attempt, item by item. `admin` adds overrides, the day decision and the
// report status; the doctor's view is read-only.
export function AttemptReview({ data, admin }: { data: AttemptReviewData; admin: boolean }) {
  const { attempt, items, unlock } = data;
  const resultText = attempt.result ? RESULT_LABELS[attempt.result as keyof typeof RESULT_LABELS] : "not finished";
  // A retrain or recheck of one workflow: VFDA decides its result when it's in review.
  const drill = attempt.kind === "day" ? null : attempt.kind === "retrain" ? "Retrain" : "Recheck";
  const workflow = items[0]?.workflow ?? "";
  const latest = !(attempt.version === "A" && data.hasVersionB);
  const canApprove = drill ? attempt.result === "review" : latest && (unlock?.status === "in_review" || unlock?.status === "retake");
  const canRetake = drill ? attempt.result === "review" : latest && attempt.version === "A" && unlock?.status === "in_review";

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {data.vaName}: {drill ? `${drill} ${workflow}` : attempt.schedule_day}
          {!drill && attempt.version === "B" && " (version B)"}
        </h1>
        <p className="text-sm text-foreground/60">
          {data.officeName}
          {!drill && data.day?.title && ` · ${data.day.title}`}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-foreground/60">First try</dt>
        <dd className="font-medium">
          {attempt.first_try_points === null ? "–" : `${Number(attempt.first_try_points)}/${attempt.max_points}`}
        </dd>
        <dt className="text-foreground/60">Result</dt>
        <dd className="font-medium">{resultText}</dd>
        {!drill && (
          <>
            <dt className="text-foreground/60">Day</dt>
            <dd>{unlock ? (UNLOCK_LABELS[unlock.status] ?? unlock.status) : "–"}</dd>
          </>
        )}
        <dt className="text-foreground/60">VA feedback</dt>
        <dd>{attempt.feedback_released_at ? `released ${showDate(attempt.feedback_released_at.slice(0, 10))}` : "not released yet"}</dd>
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

      {admin && (
        <div className="flex flex-col gap-3">
          <ReportStatus attemptId={attempt.id} rows={data.notifications} />
          {(canApprove || canRetake) && (
            <div className="flex flex-wrap items-center gap-2">
              {canApprove && (
                <ActionButton action={decideAttempt.bind(null, attempt.id, "pass")} label={drill ? "Passed" : "Approve unlock"} primary />
              )}
              {canRetake && (
                <ActionButton
                  action={decideAttempt.bind(null, attempt.id, "retake")}
                  label={drill ? "Failed (retrain)" : "Assign retake"}
                />
              )}
            </div>
          )}
          {attempt.submitted_at && !attempt.feedback_released_at && (
            <ActionButton action={releaseFeedback.bind(null, attempt.id)} label="Release feedback to VA" />
          )}
          {!drill && attempt.version === "B" && unlock?.status === "in_review" && (
            <p className="text-sm">Version B was the retake: approve it, or set up a call with the VA.</p>
          )}
        </div>
      )}

      <ol className="flex flex-col gap-4">
        {items.map((item) => (
          <Item key={item.id} item={item} admin={admin} />
        ))}
      </ol>
    </>
  );
}

function scoreText(score: number | null, max: number) {
  return score === null ? "needs review" : `${score}/${max}`;
}

function Item({ item, admin }: { item: ReviewItem; admin: boolean }) {
  const max = item.type === "mc" ? item.points : 2;
  const o = item.override;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{item.code}</span>
        <span className="text-sm text-foreground/60">
          {item.workflow} · {item.type === "mc" ? "multiple choice" : "situational"}
          {item.seconds !== null && ` · ${Math.max(1, Math.round(item.seconds / 60))} min`}
        </span>
        <span className="flex flex-wrap gap-1 text-xs">
          {item.criticalError && <Badge tone="red">critical error</Badge>}
          {item.needsReview && <Badge tone="amber">needs review</Badge>}
          {item.type === "situational" && item.confidence !== null && item.confidence < 0.7 && !o && (
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
    </li>
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

// Where the report went; a red "report not sent" badge and "Resend" when any part didn't.
export function ReportStatus({ attemptId, rows }: { attemptId: string; rows: Pick<NoteRow, "channel" | "recipient" | "status" | "error">[] }) {
  const sent = rows.filter((r) => r.status === "sent");
  const failed = rows.filter((r) => r.status === "failed");
  const pending = rows.filter((r) => r.status === "pending");
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {(failed.length > 0 || rows.length === 0) && <Badge tone="red">report not sent</Badge>}
        {sent.length > 0 && <span>Report sent to {sent.map((r) => r.recipient).join(", ")}</span>}
        {pending.length > 0 && <span className="text-foreground/60">sending to {pending.map((r) => r.recipient).join(", ")}…</span>}
        {(failed.length > 0 || rows.length === 0) && (
          <ActionButton action={resendAttemptReport.bind(null, attemptId)} label="Resend" pendingLabel="Sending…" />
        )}
      </div>
      {failed.map((r) => (
        <span key={`${r.channel}:${r.recipient}`} className="text-red-700 dark:text-red-400">
          {r.recipient}: {r.error ?? "not sent"}
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

import Link from "next/link";
import { Suspense } from "react";
import { callDate, callLength, callTitle, RESULT_LABEL, resultTone } from "@/components/calls/call-feedback";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, ButtonLink, Card, EmptyState, linkClass, Notice, PageHeader, ProgressBar, Table, td, th } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { ACCESS_MESSAGES, callAccess, callsStartedToday } from "@/lib/call-practice/access";
import { effectiveResult, GOAL, loadCallsFor, passRateText, summarize, type Bucket } from "@/lib/call-practice/progress";
import { ROLEPLAY_TITLES, ROLEPLAYS, type Roleplay } from "@/lib/call-practice/types";
import { createAdminClient } from "@/lib/supabase/server";

export default function CallPracticePage() {
  return (
    <SignedInPage area="VA">
      <PageHeader
        title="Call practice"
        description="Practice phone calls with an AI patient that follows your office's phone scripts and scheduling."
        breadcrumbs={[{ label: "Today", href: "/va" }, { label: "Call practice" }]}
      />
      <Suspense fallback={<Loading />}>
        <CallPractice />
      </Suspense>
    </SignedInPage>
  );
}

function Goal({ title, bucket, type, about }: { title: string; bucket: Bucket; type: "easy" | "challenging"; about: string }) {
  return (
    <Card title={title}>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-2xl font-semibold tabular-nums">
          {Math.min(bucket.finished, GOAL)} <span className="text-base font-normal text-muted">of {GOAL}</span>
        </span>
        <span className="text-muted">{passRateText(bucket)}</span>
        {bucket.finished > GOAL && <span className="text-muted">({bucket.finished} calls in all)</span>}
      </p>
      <ProgressBar value={Math.min(bucket.finished, GOAL)} max={GOAL} label={`${title}: ${bucket.finished} of ${GOAL}`} />
      <p className="text-[0.9375rem] text-muted">{about}</p>
      <div>
        <ButtonLink href={`/va/calls/new?type=${type}`} variant="primary">
          Start {type === "easy" ? "an easy" : "a challenging"} call
        </ButtonLink>
      </div>
    </Card>
  );
}

async function CallPractice() {
  const user = await requireRole("va");
  const db = createAdminClient();
  const access = await callAccess(user, db);
  if (!access.allowed) {
    return (
      <Notice tone="info" title="Call practice isn't available">
        <p>{ACCESS_MESSAGES[access.reason]}</p>
      </Notice>
    );
  }
  const [calls, used] = await Promise.all([loadCallsFor(db, { vaIds: [user.id] }), callsStartedToday(user.id, access.timeZone, db)]);
  const p = summarize(calls);
  const left = Math.max(0, access.settings.dailyCap - used);
  const recent = calls.filter((c) => c.status === "finished").slice(0, 15);

  const roleplayRow = (day: "w2d1_roleplay" | "w2d2_roleplay", r: Roleplay) => (
    <li key={r} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line px-3 py-2.5">
      <span className="min-w-0">
        <span className="font-medium">{day === "w2d1_roleplay" ? "W2D1" : "W2D2"}:</span> {ROLEPLAY_TITLES[r]}
      </span>
      {p.roleplays[r] ? (
        <Badge tone="success">Passed</Badge>
      ) : (
        <ButtonLink href={`/va/calls/new?type=${day}&roleplay=${r}`} size="sm">
          Start
        </ButtonLink>
      )}
    </li>
  );

  return (
    <>
      {left === 0 ? (
        <Notice tone="warning" title="That's all for today">
          You&apos;ve used all {access.settings.dailyCap} practice calls for today. You can practice again tomorrow.
        </Notice>
      ) : (
        <p className="text-muted">
          {left} of {access.settings.dailyCap} practice calls left today. Use Chrome and a headset.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Goal title="Easy calls" bucket={p.easy} type="easy" about="Friendly callers: booking, rescheduling, confirmations and quick questions. W2D1 roleplays count here." />
        <Goal
          title="Challenging calls"
          bucket={p.challenging}
          type="challenging"
          about="Price and insurance questions, objections, busy or upset callers, scheduling pushback. W2D2 roleplays count here."
        />
      </div>

      <Card title="Required roleplays" description="Three passed W2D1 calls and three passed W2D2 calls count as that day's roleplay proof.">
        <ul className="flex flex-col gap-2">
          {ROLEPLAYS.w2d1_roleplay.map((r) => roleplayRow("w2d1_roleplay", r))}
          {ROLEPLAYS.w2d2_roleplay.map((r) => roleplayRow("w2d2_roleplay", r))}
        </ul>
      </Card>

      <Card title="Recent calls">
        {!recent.length ? (
          <EmptyState title="No calls yet">Your calls and their feedback show up here.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Call</th>
                <th className={th}>Length</th>
                <th className={th}>Result</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => {
                const r = effectiveResult(c);
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className={td}>{callDate(c.started_at, access.timeZone)}</td>
                    <td className={td}>
                      <Link href={`/va/calls/${c.id}`} className={linkClass}>
                        {callTitle(c)}
                      </Link>
                    </td>
                    <td className={`${td} tabular-nums`}>{callLength(c)}</td>
                    <td className={td}>{r ? <Badge tone={resultTone(r)}>{RESULT_LABEL[r]}</Badge> : <span className="text-muted">Feedback pending</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

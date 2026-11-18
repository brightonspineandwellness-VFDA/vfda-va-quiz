import Link from "next/link";
import { after } from "next/server";
import { Suspense, type ReactNode } from "react";
import { SopForm } from "@/components/certs/sop-form";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, ButtonLink, Card, EmptyState, linkClass, NumberBadge, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadVaTasks } from "@/lib/certifications";
import { sendPreparingNotice } from "@/lib/reports";
import { markTodaysCardsDone, startDayRetake } from "@/lib/va-actions";
import { DayProgress } from "@/components/reports/skills";
import { createAdminClient } from "@/lib/supabase/server";
import { COMPLETED, proofState, RESULT_LABELS, resultLabel, showDate, type DayView, type UnlockStatus } from "@/lib/va-flow";
import { claimPreparingNotice, loadRetakeTasks, loadToday } from "@/lib/va-training";

// "Practice this day again" waits while Claude writes the day's new versions.
export const maxDuration = 300;

export default function VaPage() {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <Today />
      </Suspense>
    </SignedInPage>
  );
}

const STATUS_LABELS: Record<UnlockStatus, string> = {
  locked: "Locked",
  open: "Open",
  done: "Done",
};

const PROOF_LABELS: Partial<Record<ReturnType<typeof proofState>, { label: string; tone: "warning" | "danger" | "success" | "neutral" }>> = {
  pending: { label: "Waiting for VFDA", tone: "warning" },
  redo: { label: "Redo proof", tone: "danger" },
  missing: { label: "Proof needed", tone: "neutral" },
  accepted: { label: "Accepted", tone: "success" },
};

async function Today() {
  const user = await requireRole("va");
  const loaded = await loadToday(user);

  if (loaded.kind === "no_office") {
    return (
      <>
        <PageHeader title="Today" />
        <EmptyState title="Your account isn't linked to an office yet">VFDA will set this up.</EmptyState>
      </>
    );
  }
  const { today, officeName, proofs } = loaded;
  // Cards marked done before VFDA approved the day: make sure VFDA was told (once).
  if (today.kind === "preparing" && (await claimPreparingNotice(user, today.current.day.code))) {
    const day = today.current.day.code;
    after(() => sendPreparingNotice(user.id, day).then(() => undefined));
  }
  const total = "days" in today ? today.days.length : 0;
  // Each finished day's label (never a score).
  const { data: finished } = await createAdminClient()
    .from("attempts")
    .select("schedule_day, result, submitted_at")
    .eq("va_id", user.id)
    .eq("office_id", user.officeId ?? "")
    .eq("kind", "day")
    .not("submitted_at", "is", null)
    .is("archived_at", null)
    .order("submitted_at");
  const labelOf = new Map<string, string | null>();
  for (const a of finished ?? []) if (!labelOf.has(a.schedule_day)) labelOf.set(a.schedule_day, a.result);
  const doneCount = "days" in today ? today.days.filter((d) => d.status === "done").length : 0;

  return (
    <>
      <PageHeader
        title="Today"
        description={`${user.fullName || user.email} · ${officeName}`}
        actions={
          <>
            <ButtonLink href="/va/results">My results</ButtonLink>
            <ButtonLink href="/va/proof">Proof of work</ButtonLink>
          </>
        }
      />

      {today.kind === "no_days" && <EmptyState title="No training days yet">No training days are set up for your office yet.</EmptyState>}
      {today.kind === "finished" && (
        <Card>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <StatusBadge label="Done" /> You&apos;ve finished every training day.
          </p>
        </Card>
      )}
      {today.kind === "open" && (
        <DayCard view={today.current} total={total} badge={<StatusBadge label="Open" />}>
          <ButtonLink href="/va/day" variant="primary" className="self-start">
            Go to today&apos;s scenarios →
          </ButtonLink>
        </DayCard>
      )}
      {today.kind === "cards" && (
        <DayCard view={today.current} total={total} badge={<Badge tone="primary">Up next</Badge>}>
          <p className="text-[0.9375rem]">Read today&apos;s cards, then mark them done to open the quiz.</p>
          <div>
            <ActionButton action={markTodaysCardsDone} label="Mark today's cards done & start quiz" primary />
          </div>
        </DayCard>
      )}
      {today.kind === "preparing" && (
        <DayCard view={today.current} total={total} badge={<StatusBadge label="Pending" />}>
          <p>Your quiz is being prepared, VFDA has been notified.</p>
          <p className="text-sm text-muted">Come back to this page later; the quiz opens here as soon as it&apos;s ready.</p>
        </DayCard>
      )}

      {user.officeId && <Tasks vaId={user.id} officeId={user.officeId} />}

      {"days" in today && (
        <Card title="Your progress" description={`Day ${doneCount} of ${total} completed`}>
          <DayProgress progress={{ done: doneCount, total }} compact />
          <Table>
            <thead>
              <tr>
                <th className={th}>Day</th>
                <th className={th}>Topic</th>
                <th className={th}>Status</th>
                <th className={th}>Proof of work</th>
              </tr>
            </thead>
            <tbody>
              {today.days.map((d) => {
                const proof = d.status === "locked" ? null : proofState(d.day, proofs);
                const p = proof ? PROOF_LABELS[proof] : undefined;
                return (
                  <tr key={d.day.code}>
                    <td className={`${td} whitespace-nowrap font-medium`}>
                      Day {d.index} <span className="text-sm font-normal text-muted">{d.day.code}</span>
                    </td>
                    <td className={`${td} min-w-40`}>{d.day.title}</td>
                    <td className={td}>
                      {d.status === "done" ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge label={COMPLETED} />
                          {labelOf.get(d.day.code) && <StatusBadge label={resultLabel(labelOf.get(d.day.code))} />}
                        </span>
                      ) : (
                        <StatusBadge label={d.status === "open" ? "Open now" : STATUS_LABELS[d.status]} tone={d.status === "open" ? "info" : undefined} />
                      )}
                    </td>
                    <td className={td}>{p ? <Badge tone={p.tone}>{p.label}</Badge> : <span className="text-sm text-muted">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="text-sm text-muted">
            The skills you showed and what to practice for each finished day are on{" "}
            <Link href="/va/results" className={linkClass}>
              My results
            </Link>
            .
          </p>
        </Card>
      )}
    </>
  );
}

// The day's card: day number badge, topic, "Day X of N", the cards to study.
function DayCard({ view, total, badge, children }: { view: DayView; total: number; badge: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <NumberBadge n={view.index} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{view.day.title}</h2>
            {badge}
          </div>
          <p className="text-sm text-muted">
            Day {view.index} of {total} · {view.day.code}
          </p>
        </div>
      </div>
      <CardList view={view} />
      {children}
    </Card>
  );
}

// Rechecks to do, optional retakes, and Trello cards to update. None of
// them blocks the next day.
async function Tasks({ vaId, officeId }: { vaId: string; officeId: string }) {
  const [{ sop, drills }, retakes] = await Promise.all([loadVaTasks(vaId, officeId), loadRetakeTasks(vaId, officeId)]);
  if (!sop.length && !drills.length && !retakes.length) return null;
  return (
    <>
      {retakes.map((t) =>
        t.kind === "open" ? (
          <Card key={t.parentId} accent="accent">
            <Badge tone="accent" className="self-start">
              Practice this day again (optional)
            </Badge>
            <p className="text-lg font-semibold">
              {t.day}: {t.title}
            </p>
            <p className="text-[0.9375rem]">Every question of the day again, with new details.</p>
            <ButtonLink href={`/va/drill/${t.id}`} variant="primary" className="self-start">
              Continue practice →
            </ButtonLink>
          </Card>
        ) : (
          <Card key={t.parentId} accent="accent">
            <Badge tone="accent" className="self-start">
              Practice this day again (optional)
            </Badge>
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {t.day}: {t.title} <StatusBadge label={RESULT_LABELS[t.result]} />
            </p>
            <p className="text-[0.9375rem]">
              You can practice this whole day once more, with new details. It&apos;s optional and doesn&apos;t block your next day.
            </p>
            <div>
              <ActionButton
                action={startDayRetake.bind(null, t.parentId)}
                label="Practice this day again"
                pendingLabel="Preparing your practice (about a minute)…"
              />
            </div>
          </Card>
        ),
      )}
      {drills.map((d) => (
        <Card key={d.id} accent="warning">
          <Badge tone="warning" className="self-start">
            Recheck
          </Badge>
          <p className="text-lg font-semibold">
            {d.code} {d.name}
          </p>
          <p className="text-[0.9375rem]">A short recheck to keep your certification: 5 scenarios.</p>
          <ButtonLink href={`/va/drill/${d.id}`} variant="primary" className="self-start">
            Start →
          </ButtonLink>
        </Card>
      ))}
      {sop.map((t) => (
        <Card key={t.certificationId} title={`Update your office's Trello card for ${t.code} ${t.name}`}>
          {t.note && t.sopStatus !== "pending" && (
            <p className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm">
              <span className="font-semibold">VFDA: </span>
              {t.note}
            </p>
          )}
          {t.todo ? (
            <>
              <div className="text-[0.9375rem]">
                <p className="font-semibold">The card should cover:</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {t.outline.map((o) => (
                    <li key={o}>☐ {o}</li>
                  ))}
                </ul>
              </div>
              <SopForm certificationId={t.certificationId} links={t.links} />
            </>
          ) : (
            <p className="text-sm text-muted">
              Sent {t.submittedAt ? showDate(t.submittedAt.slice(0, 10)) : ""}. Waiting for VFDA to confirm the doctor approved it on Trello.{" "}
              {t.links.length > 1 ? `${t.links.length} cards.` : ""}
            </p>
          )}
        </Card>
      ))}
    </>
  );
}

// The cards to study for the day.
function CardList({ view }: { view: DayView }) {
  if (!view.day.cards.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-semibold text-foreground">Cards to study</p>
      <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
        {view.day.cards.map((c) => (
          <li key={c} className="px-3 py-2 text-[0.9375rem]">
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

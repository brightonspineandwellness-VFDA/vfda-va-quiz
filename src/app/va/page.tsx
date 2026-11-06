import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { SopForm } from "@/components/certs/sop-form";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { loadVaTasks } from "@/lib/certifications";
import { sendPreparingNotice } from "@/lib/reports";
import { markTodaysCardsDone, startDayRetake } from "@/lib/va-actions";
import { dayName, proofState, RESULT_LABELS, showDate, type DayView, type UnlockStatus } from "@/lib/va-flow";
import { claimPreparingNotice, loadRetakeTasks, loadToday } from "@/lib/va-training";

// "Retake this day" waits while Claude writes the day's new versions.
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

const card = "flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4";

async function Today() {
  const user = await requireRole("va");
  const loaded = await loadToday(user);

  if (loaded.kind === "no_office") {
    return (
      <>
        <h1 className="text-2xl font-semibold">Today</h1>
        <p>Your account isn&apos;t linked to an office yet. VFDA will set this up.</p>
      </>
    );
  }
  const { today, officeName, proofs } = loaded;
  // Cards marked done before VFDA approved the day: make sure VFDA was told (once).
  if (today.kind === "preparing" && (await claimPreparingNotice(user, today.current.day.code))) {
    const day = today.current.day.code;
    after(() => sendPreparingNotice(user.id, day).then(() => undefined));
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-foreground/60">
          {user.fullName || user.email} · {officeName}
        </p>
      </div>

      {today.kind === "no_days" && <p>No training days are set up for your office yet.</p>}
      {today.kind === "finished" && (
        <div className={card}>
          <p className="font-medium">You&apos;ve finished every training day.</p>
        </div>
      )}
      {today.kind === "open" && (
        <div className={card}>
          <p className="text-sm font-medium text-green-700 dark:text-green-400">Open now</p>
          <p className="text-lg font-semibold">{dayName(today.current)}</p>
          <CardList view={today.current} />
          <Link href="/va/day" className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background">
            Go to today&apos;s scenarios →
          </Link>
        </div>
      )}
      {today.kind === "cards" && (
        <div className={card}>
          <p className="text-sm font-medium text-foreground/60">Up next</p>
          <p className="text-lg font-semibold">{dayName(today.current)}</p>
          <CardList view={today.current} />
          <p>Read today&apos;s cards, then mark them done to open the quiz.</p>
          <ActionButton action={markTodaysCardsDone} label="Mark today's cards done" primary />
        </div>
      )}
      {today.kind === "preparing" && (
        <div className={card}>
          <p className="text-lg font-semibold">{dayName(today.current)}</p>
          <p>Your quiz is being prepared, VFDA has been notified.</p>
          <p className="text-sm text-foreground/60">Come back to this page later; the quiz opens here as soon as it&apos;s ready.</p>
        </div>
      )}

      {user.officeId && <Tasks vaId={user.id} officeId={user.officeId} />}

      {"days" in today && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Your training days</h2>
            <span className="flex gap-3 text-sm">
              <Link href="/va/results" className="underline">
                My results
              </Link>
              <Link href="/va/proof" className="underline">
                Proof of work
              </Link>
            </span>
          </div>
          <ol className="flex flex-col divide-y divide-foreground/10 rounded-lg border border-foreground/15">
            {today.days.map((d) => {
              const proof = d.status === "locked" ? null : proofState(d.day, proofs);
              return (
                <li key={d.day.code} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>{dayName(d)}</span>
                  <span className="text-foreground/70">
                    {STATUS_LABELS[d.status]}
                    {proof === "pending" && " · proof waiting for VFDA"}
                    {proof === "redo" && " · redo proof"}
                    {proof === "missing" && " · proof needed"}
                    {proof === "accepted" && " · proof accepted"}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
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
          <div key={t.parentId} className={card}>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Retake (optional)</p>
            <p className="text-lg font-semibold">
              {t.day}: {t.title}
            </p>
            <p className="text-sm">
              Every question of the day again, with new details. Your first try stays your official score.
            </p>
            <Link href={`/va/drill/${t.id}`} className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background">
              Continue retake →
            </Link>
          </div>
        ) : (
          <div key={t.parentId} className={card}>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Retake available (optional)</p>
            <p className="text-lg font-semibold">
              {t.day}: {t.title} · {RESULT_LABELS[t.result]}
            </p>
            <p className="text-sm">
              You can retake this whole day once, with new details. It&apos;s optional and doesn&apos;t block your next
              day. Your first try stays your official score.
            </p>
            <ActionButton
              action={startDayRetake.bind(null, t.parentId)}
              label="Retake this day"
              pendingLabel="Preparing your retake (about a minute)…"
            />
          </div>
        ),
      )}
      {drills.map((d) => (
        <div key={d.id} className={card}>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Recheck</p>
          <p className="text-lg font-semibold">
            {d.code} {d.name}
          </p>
          <p className="text-sm">A short recheck to keep your certification: 5 scenarios.</p>
          <Link href={`/va/drill/${d.id}`} className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background">
            Start →
          </Link>
        </div>
      ))}
      {sop.map((t) => (
        <div key={t.certificationId} className={card}>
          <p className="text-lg font-semibold">
            Update your office&apos;s Trello card for {t.code} {t.name}
          </p>
          {t.note && t.sopStatus !== "pending" && (
            <p className="rounded-lg bg-foreground/5 px-3 py-2 text-sm">
              <span className="font-medium">VFDA: </span>
              {t.note}
            </p>
          )}
          {t.todo ? (
            <>
              <div className="text-sm">
                <p className="font-medium">The card should cover:</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {t.outline.map((o) => (
                    <li key={o}>☐ {o}</li>
                  ))}
                </ul>
              </div>
              <SopForm certificationId={t.certificationId} links={t.links} />
            </>
          ) : (
            <p className="text-sm text-foreground/70">
              Sent {t.submittedAt ? showDate(t.submittedAt.slice(0, 10)) : ""}. Waiting for VFDA to confirm the doctor approved it on
              Trello. {t.links.length > 1 ? `${t.links.length} cards.` : ""}
            </p>
          )}
        </div>
      ))}
    </>
  );
}

function CardList({ view }: { view: DayView }) {
  return <p className="text-sm text-foreground/70">Cards: {view.day.cards.join(", ")}</p>;
}

import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { markTodaysCardsDone } from "@/lib/va-actions";
import { dayName, proofState, type DayView, type UnlockStatus } from "@/lib/va-flow";
import { loadToday } from "@/lib/va-training";

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
  submitted: "Grading",
  passed: "Passed",
  in_review: "With VFDA",
  retake: "Retake",
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
          <p className="font-medium">You&apos;ve passed every training day.</p>
        </div>
      )}
      {today.kind === "open" && (
        <div className={card}>
          <p className="text-sm font-medium text-green-700 dark:text-green-400">Open now</p>
          <p className="text-lg font-semibold">{dayName(today.current)}</p>
          {today.current.version === "B" && <p className="text-sm">This is your retake (version B).</p>}
          <CardList view={today.current} />
          <Link href="/va/day" className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background">
            Go to today&apos;s scenarios →
          </Link>
        </div>
      )}
      {today.kind === "waiting" && (
        <div className={card}>
          <p className="text-lg font-semibold">{dayName(today.current)}</p>
          <p>{today.message}</p>
        </div>
      )}
      {today.kind === "blocked" && (
        <div className={card}>
          <p className="text-sm font-medium text-foreground/60">Up next</p>
          <p className="text-lg font-semibold">{dayName(today.current)}</p>
          {today.current.status === "retake" && <p className="text-sm">This is your retake (version B).</p>}
          <CardList view={today.current} />
          <p className="font-medium">It opens when all of these are done:</p>
          <ul className="flex flex-col gap-1.5">
            {today.checks.map((c) => (
              <li key={c.key} className="flex gap-2">
                <span
                  aria-label={c.ok ? "Done" : "Not yet"}
                  className={c.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}
                >
                  {c.ok ? "✓" : "✗"}
                </span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          {today.checks.some((c) => c.key === "cards" && !c.ok) && (
            <ActionButton action={markTodaysCardsDone} label="Mark today's cards done" primary />
          )}
          {today.checks.some((c) => c.key === "proof" && !c.ok) && (
            <Link href="/va/proof" className="self-start text-sm underline">
              Proof of work →
            </Link>
          )}
        </div>
      )}

      {"days" in today && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Your training days</h2>
            <Link href="/va/proof" className="text-sm underline">
              Proof of work
            </Link>
          </div>
          <ol className="flex flex-col divide-y divide-foreground/10 rounded-lg border border-foreground/15">
            {today.days.map((d) => {
              const proof = d.status === "locked" ? null : proofState(d.day, proofs);
              return (
                <li key={d.day.code} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>{dayName(d)}</span>
                  <span className="text-foreground/70">
                    {STATUS_LABELS[d.status]}
                    {d.version === "B" && " (version B)"}
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

function CardList({ view }: { view: DayView }) {
  return <p className="text-sm text-foreground/70">Cards: {view.day.cards.join(", ")}</p>;
}

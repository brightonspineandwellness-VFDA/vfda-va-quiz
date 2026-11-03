import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { FeedbackList, loadFeedback } from "@/components/va/attempt-feedback";
import { requireRole } from "@/lib/auth";
import { CERT_LABELS, SOP_LABELS } from "@/lib/certification";
import { loadCertGrid } from "@/lib/certifications";
import { TREND_LABELS } from "@/lib/report";
import { createAdminClient } from "@/lib/supabase/server";
import { percentOf, showDate, trend } from "@/lib/va-flow";

export default function ResultsPage() {
  return (
    <SignedInPage area="VA">
      <Link href="/va" className="text-sm text-foreground/60 hover:underline">
        ← Today
      </Link>
      <h1 className="text-2xl font-semibold">My results</h1>
      <Suspense fallback={<Loading />}>
        <Results />
      </Suspense>
    </SignedInPage>
  );
}

// Scores and feedback for every finished day (shown right away), the trend
// across days, and where each workflow stands. Read on the server for this VA
// only; never answer keys.
async function Results() {
  const user = await requireRole("va");
  const db = createAdminClient();
  const [{ data: attempts }, grid] = await Promise.all([
    db
      .from("attempts")
      .select("id, schedule_day, kind, submitted_at, first_try_points, max_points")
      .eq("va_id", user.id)
      .eq("office_id", user.officeId ?? "")
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at"),
    loadCertGrid(db, { vaIds: [user.id] }),
  ]);
  const done = attempts ?? [];
  const feedback = await loadFeedback(done.map((a) => a.id));
  const direction = trend(done.filter((a) => a.kind === "day").map((a) => percentOf(a.first_try_points, a.max_points)));
  const row = grid.rows[0];
  const label = (a: { kind: string; schedule_day: string }) =>
    a.kind === "day" ? a.schedule_day : a.kind === "retrain" ? "Retrain" : "Recheck";

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Workflows</h2>
        {row?.allCertified && (
          <Link href="/va/certificate" className="self-start rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
            Your certificate
          </Link>
        )}
        <ul className="flex flex-col divide-y divide-foreground/10 rounded-lg border border-foreground/15 text-sm">
          {(row?.cells ?? [])
            .filter((c) => c.applies)
            .map((c) => (
              <li key={c.code} className="flex flex-col gap-1 px-4 py-2">
                <span>
                  <span className="font-medium">
                    {c.code} {c.name}:
                  </span>{" "}
                  {c.status ? CERT_LABELS[c.status] : "not reached yet"}
                  {c.status === "certified" && c.recheckDate && ` (recheck ${showDate(c.recheckDate)})`}
                  {c.status !== "certified" && c.submittedAt && c.sopStatus && ` · Trello card: ${SOP_LABELS[c.sopStatus]}`}
                </span>
                {c.sopNote && c.status !== "certified" && <span className="text-foreground/70">VFDA: {c.sopNote}</span>}
              </li>
            ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Scores and feedback</h2>
        {direction && <p className="text-sm">Your first-try scores across days: {TREND_LABELS[direction].toLowerCase()}.</p>}
        {!done.length && <p className="text-sm">No finished days yet.</p>}
        {done.map((a) => (
          <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3 text-sm">
            <p className="font-medium">
              {label(a)}: {Number(a.first_try_points)}/{a.max_points} first try ({percentOf(a.first_try_points, a.max_points)}%)
            </p>
            <FeedbackList items={feedback.get(a.id) ?? []} />
          </div>
        ))}
      </section>
    </>
  );
}

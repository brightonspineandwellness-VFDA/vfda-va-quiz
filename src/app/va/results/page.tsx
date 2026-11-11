import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { CERT_LABELS, SOP_LABELS } from "@/lib/certification";
import { loadCertGrid } from "@/lib/certifications";
import { TREND_LABELS } from "@/lib/report";
import { createAdminClient } from "@/lib/supabase/server";
import { attemptLabel, percentOf, resultLabel, showDate, todayIn, trend } from "@/lib/va-flow";

const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";

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

// Where each workflow stands, and every finished quiz with its report (My
// report): first-try score, result label, RETAKE. Read on the server for this
// VA only; never scenarios, answers or answer keys.
async function Results() {
  const user = await requireRole("va");
  const db = createAdminClient();
  const [{ data: attempts }, { data: days }, grid] = await Promise.all([
    db
      .from("attempts")
      .select("id, schedule_day, kind, submitted_at, first_try_points, max_points, result")
      .eq("va_id", user.id)
      .eq("office_id", user.officeId ?? "")
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at", { ascending: false }),
    db.from("schedule_days").select("code, title"),
    loadCertGrid(db, { vaIds: [user.id] }),
  ]);
  const done = attempts ?? [];
  const titleOf = new Map((days ?? []).map((d) => [d.code, d.title as string]));
  const direction = trend(
    done
      .filter((a) => a.kind === "day")
      .reverse()
      .map((a) => percentOf(a.first_try_points, a.max_points)),
  );
  const row = grid.rows[0];

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My quizzes</h2>
        {direction && <p className="text-sm">Your first-try scores across days: {TREND_LABELS[direction].toLowerCase()}.</p>}
        {!done.length && <p className="text-sm">No finished quizzes yet.</p>}
        <ul className="flex flex-col divide-y divide-foreground/10 rounded-lg border border-foreground/15 text-sm">
          {done.map((a) => (
            <li key={a.id}>
              <Link href={`/va/results/${a.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-foreground/5">
                <span className="font-medium">
                  {a.kind === "day" || a.kind === "retake" ? a.schedule_day : attemptLabel(a)}
                  {(a.kind === "day" || a.kind === "retake") && titleOf.get(a.schedule_day) && `: ${titleOf.get(a.schedule_day)}`}
                </span>
                {a.kind === "retake" && <span className="rounded bg-blue-700 px-2 py-0.5 text-xs font-semibold text-white">RETAKE</span>}
                <span className="text-foreground/60">{showDate(todayIn(TIME_ZONE, new Date(a.submitted_at!)))}</span>
                <span>{percentOf(a.first_try_points, a.max_points)}% first try</span>
                <span className="text-foreground/70">{resultLabel(a.result)}</span>
                <span className="ml-auto text-foreground/60">My report →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

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
                {c.retakeNote && <span className="text-foreground/70">{c.retakeNote}</span>}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}

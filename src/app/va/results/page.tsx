import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { CERT_LABELS, SOP_LABELS } from "@/lib/certification";
import { loadCertGrid } from "@/lib/certifications";
import { RESULT_LABELS } from "@/lib/report";
import { createAdminClient } from "@/lib/supabase/server";
import { showDate, withOverride } from "@/lib/va-flow";

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

type Feedback = { reason?: string; missed_steps?: string[] } | null;

// Scores and feedback once VFDA releases them, and where each workflow stands.
// Read on the server for this VA only; never answer keys.
async function Results() {
  const user = await requireRole("va");
  const db = createAdminClient();
  const [{ data: attempts }, grid] = await Promise.all([
    db
      .from("attempts")
      .select("id, schedule_day, version, kind, submitted_at, first_try_points, max_points, result, feedback_released_at")
      .eq("va_id", user.id)
      .not("submitted_at", "is", null)
      .order("submitted_at"),
    loadCertGrid(db, { vaIds: [user.id] }),
  ]);
  const released = (attempts ?? []).filter((a) => a.feedback_released_at);
  const waiting = (attempts ?? []).filter((a) => !a.feedback_released_at);
  const { data: items } = released.length
    ? await db
        .from("attempt_items")
        .select("attempt_id, office_scenario_id, position, first_score, first_feedback, repeat_scenario_id, repeat_score, repeat_feedback, critical_error, ai_confidence, vfda_override")
        .in(
          "attempt_id",
          released.map((a) => a.id),
        )
        .order("position")
    : { data: [] };
  const ids = [...new Set((items ?? []).map((i) => i.office_scenario_id))];
  const { data: scenarios } = ids.length
    ? await db.from("office_scenarios").select("id, code, workflow, type, points").in("id", ids)
    : { data: [] };
  const scenarioOf = new Map((scenarios ?? []).map((s) => [s.id, s]));
  const row = grid.rows[0];
  const label = (a: { kind: string; schedule_day: string; version: string }) =>
    a.kind === "day" ? `${a.schedule_day}${a.version === "B" ? " (version B)" : ""}` : a.kind === "retrain" ? "Retrain" : "Recheck";

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
        {waiting.length > 0 && (
          <p className="text-sm text-foreground/70">
            Waiting for VFDA to release: {waiting.map(label).join(", ")}.
          </p>
        )}
        {!released.length && <p className="text-sm">Nothing released yet.</p>}
        {released.map((a) => (
          <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3 text-sm">
            <p className="font-medium">
              {label(a)}: {Number(a.first_try_points)}/{a.max_points} first try · {RESULT_LABELS[a.result as keyof typeof RESULT_LABELS]?.split(" (")[0]}
            </p>
            <ul className="flex flex-col gap-2">
              {(items ?? [])
                .filter((i) => i.attempt_id === a.id)
                .map((raw) => {
                  const s = scenarioOf.get(raw.office_scenario_id);
                  const i = withOverride({ ...raw, ai_confidence: null }, raw.vfda_override);
                  const max = s?.type === "mc" ? s.points : 2;
                  const first = raw.first_feedback as Feedback;
                  const again = raw.repeat_feedback as Feedback;
                  return (
                    <li key={raw.office_scenario_id}>
                      <span className="font-medium">{s?.code}</span>: {i.first_score ?? "–"}/{max} first try
                      {raw.repeat_scenario_id && `, ${i.repeat_score ?? "–"}/${max} on repeat`}
                      {i.critical_error && " · critical error"}
                      {first?.reason && <span className="block text-foreground/70">{first.reason}</span>}
                      {(first?.missed_steps ?? []).map((m) => (
                        <span key={m} className="block text-foreground/70">
                          Missed: {m}
                        </span>
                      ))}
                      {again?.reason && <span className="block text-foreground/70">Repeat: {again.reason}</span>}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { AttemptLink, ReportStatus } from "@/components/attempts/attempt-review";
import { CertGrid } from "@/components/certs/cert-grid";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ActionButton } from "@/components/setup/action-button";
import { ProofReview, StartDateForm } from "@/components/va/proof-review";
import { requireRole } from "@/lib/auth";
import { daysBetween, SOP_WAIT_FLAG_DAYS } from "@/lib/certification";
import { loadCertGrid } from "@/lib/certifications";
import { TREND_LABELS } from "@/lib/report";
import { loadReminderBoard, type VaReminder } from "@/lib/reminders";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { resetDay } from "@/lib/va-admin-actions";
import { applies } from "@/lib/interview";
import { attemptLabel, officeProfile, percentOf, resultLabel, sinceStartText, todayIn, trend, unlockStatus } from "@/lib/va-flow";
import { dayInScope, normalizeScope, scopeText } from "@/lib/va-scope";
import { PROOF_BUCKET } from "@/lib/va-training";

// "Send again" sends a report while you wait.
export const maxDuration = 60;

export default function VasPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">VA progress</h1>
      <Suspense fallback={<Loading />}>
        <Vas />
      </Suspense>
    </SignedInPage>
  );
}

const STATUS_LABELS: Record<string, string> = {
  locked: "locked",
  open: "open",
  done: "done",
};

const LABEL_TONE: Record<string, string> = {
  strong: "text-green-700 dark:text-green-400",
  needs_coaching: "text-amber-700 dark:text-amber-300",
  at_risk: "text-red-700 dark:text-red-400",
};

// An attempt with this many pastes is flagged.
const HEAVY_PASTING = 5;
// A report still not out after this long is flagged.
const REPORT_GRACE_MS = 15 * 60 * 1000;

const minutes = (s: number | null) => (s === null ? "–" : `${Math.max(1, Math.round(s / 60))} min`);

// Overdue VAs first, then behind, then everyone else.
const STATE_RANK: Record<VaReminder["state"], number> = { overdue: 0, behind: 1, ok: 2 };

function activityText(r: VaReminder | undefined) {
  if (!r) return "–";
  const d = r.activity.daysSince;
  return d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} ago`;
}

function remindersText(r: VaReminder | undefined) {
  if (!r) return "–";
  const state = r.state === "overdue" ? "overdue" : r.state === "behind" ? (r.remindedOn ? "behind, reminded" : "behind") : "";
  return [r.remindersSent ? `${r.remindersSent} sent` : "none", state].filter(Boolean).join(" · ");
}

async function Vas() {
  await requireRole("vfda_admin");
  const supabase = await createSessionClient();
  const [vas, offices, sequence, unlocks, attempts, proofs, dayAttempts, scheduleDays, conditions] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, office_id, va_start_date, va_scope").eq("role", "va").is("deactivated_at", null).order("full_name"),
    supabase.from("offices").select("id, name, bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool"),
    supabase.from("settings").select("value").eq("key", "sequence").maybeSingle(),
    supabase.from("day_unlocks").select("va_id, office_id, schedule_day, status, cards_done_at, prep_notified_at"),
    supabase
      .from("attempts")
      .select("id, va_id, office_id, schedule_day, version, kind, parent_attempt_id, submitted_at, first_try_points, max_points, result, critical_errors, time_spent, paste_log, fast_finish")
      .not("submitted_at", "is", null)
      // Archived attempts (reset for testing) don't count.
      .is("archived_at", null)
      .order("submitted_at"),
    supabase
      .from("proof_uploads")
      .select("id, va_id, office_id, schedule_day, file_path, file_name, link_url, status, review_note, created_at")
      .order("created_at"),
    // Every day attempt, archived ones too, for "Reset day (test)".
    supabase
      .from("attempts")
      .select("id, va_id, office_id, schedule_day, build_version, submitted_at, archived_at, archived_by")
      .eq("kind", "day")
      .order("started_at"),
    supabase.from("schedule_days").select("code, condition"),
    supabase.from("settings").select("value").eq("key", "conditions").maybeSingle(),
  ]);
  // The office's days left out of a VA's roles (days they already started stay theirs).
  const outOfRole = (va: { office_id: string | null; va_scope: string[] | null }, started: string[]) => {
    const office = (offices.data ?? []).find((o) => o.id === va.office_id);
    if (!office) return [];
    const scope = normalizeScope(va.va_scope);
    const conds = (conditions.data?.value ?? {}) as Record<string, string>;
    return ((sequence.data?.value as string[] | undefined) ?? []).filter((code) => {
      const day = (scheduleDays.data ?? []).find((d) => d.code === code);
      return day && applies(day.condition, conds, officeProfile(office)) && !dayInScope(scope, code) && !started.includes(code);
    });
  };
  const resetBy = [...new Set((dayAttempts.data ?? []).map((a) => a.archived_by).filter((x): x is string => !!x))];
  const { data: resetters } = resetBy.length ? await supabase.from("profiles").select("id, email").in("id", resetBy) : { data: [] };
  const emailOf = new Map((resetters ?? []).map((p) => [p.id, p.email as string]));
  const attemptRows = attempts.data ?? [];
  const { data: items } = attemptRows.length
    ? await supabase
        .from("attempt_items")
        .select("attempt_id, position, fast, ai_confidence, first_score, repeat_score, repeat_scenario_id, vfda_override, office_scenario_id")
        .in(
          "attempt_id",
          attemptRows.map((a) => a.id),
        )
    : { data: [] };
  const { data: notes } = attemptRows.length
    ? await supabase
        .from("notifications")
        .select("attempt_id, channel, recipient, status, error")
        .eq("event", "")
        .in(
          "attempt_id",
          attemptRows.map((a) => a.id),
        )
    : { data: [] };
  const filePaths = (proofs.data ?? []).map((p) => p.file_path).filter((p): p is string => !!p);
  const { data: signed } = filePaths.length
    ? await supabase.storage.from(PROOF_BUCKET).createSignedUrls(filePaths, 3600)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const officeName = new Map((offices.data ?? []).map((o) => [o.id, o.name]));
  const order = ((sequence.data?.value as string[] | undefined) ?? []).reduce<Record<string, number>>(
    (m, code, i) => ({ ...m, [code]: i }),
    {},
  );

  if (!vas.data?.length) return <p className="text-foreground/70">No VAs yet.</p>;
  const [grid, board] = await Promise.all([loadCertGrid(supabase, {}), loadReminderBoard(createAdminClient())]);
  const reminderOf = new Map(board.map((r) => [r.vaId, r]));
  const rank = (id: string) => STATE_RANK[reminderOf.get(id)?.state ?? "ok"];
  // Stable: the name order stays within each group.
  const sortedVas = [...vas.data].sort((a, b) => rank(a.id) - rank(b.id));
  const now = new Date();

  // One line per VA: where they are, how they score, what needs a look.
  const progress = sortedVas.map((va) => {
    const days = (unlocks.data ?? [])
      .filter((u) => u.va_id === va.id && u.office_id === va.office_id)
      .sort((a, b) => (order[a.schedule_day] ?? 99) - (order[b.schedule_day] ?? 99));
    const current = days.find((d) => unlockStatus(d.status) !== "done");
    const mine = attemptRows.filter((a) => a.va_id === va.id && a.office_id === va.office_id);
    const its = (items ?? []).filter((i) => mine.some((a) => a.id === i.attempt_id));
    const repeats = its.filter((i) => i.repeat_scenario_id);
    const row = grid.rows.find((r) => r.vaId === va.id);
    const notSent = mine.filter((a) => {
      const rows = (notes ?? []).filter((n) => n.attempt_id === a.id);
      return rows.some((n) => n.status === "failed") || (!rows.length && now.getTime() - new Date(a.submitted_at).getTime() > REPORT_GRACE_MS);
    }).length;
    const sopWaiting = (row?.cells ?? []).filter(
      (c) => c.sopStatus === "pending" && c.submittedAt && daysBetween(c.submittedAt, now) > SOP_WAIT_FLAG_DAYS,
    ).length;
    const fast = mine.filter((a) => a.fast_finish).length;
    const heavy = mine.filter((a) => Array.isArray(a.paste_log) && a.paste_log.length >= HEAVY_PASTING).length;
    const critical = mine.reduce((n, a) => n + a.critical_errors, 0);
    const waiting = its.filter((i) => i.first_score === null && !i.vfda_override).length;
    const dayAttempts = mine.filter((a) => a.kind === "day");
    const latest = dayAttempts.at(-1);
    const direction = trend(dayAttempts.map((a) => percentOf(a.first_try_points, a.max_points)));
    const waitingForVfda = current && unlockStatus(current.status) === "locked" && current.prep_notified_at;
    return {
      va,
      current: current
        ? `${current.schedule_day} ${waitingForVfda ? "waiting for VFDA approval" : (STATUS_LABELS[unlockStatus(current.status)] ?? current.status)}`
        : days.length
          ? "all days done"
          : "not started",
      latest,
      scores: dayAttempts.map((a) => `${a.schedule_day} ${percentOf(a.first_try_points, a.max_points)}%`),
      trend: direction ? TREND_LABELS[direction] : "–",
      repeats: repeats.length ? `${repeats.length} (${repeats.filter((i) => i.repeat_score !== 2).length} still below 2/2)` : "–",
      flags: [
        fast > 0 && `${fast} fast finish${fast > 1 ? "es" : ""}`,
        heavy > 0 && `heavy pasting (${heavy})`,
        critical > 0 && `${critical} critical`,
        waiting > 0 && `${waiting} item${waiting > 1 ? "s" : ""} waiting for review`,
        notSent > 0 && `${notSent} report${notSent > 1 ? "s" : ""} not sent`,
        sopWaiting > 0 && `${sopWaiting} SOP link${sopWaiting > 1 ? "s" : ""} waiting > ${SOP_WAIT_FLAG_DAYS} days`,
      ].filter((f): f is string => !!f),
    };
  });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-foreground/15 text-foreground/60">
            <tr>
              <th className="py-1 pr-3 font-medium">VA</th>
              <th className="py-1 pr-3 font-medium">Office</th>
              <th className="py-1 pr-3 font-medium">Current day</th>
              <th className="py-1 pr-3 font-medium">Last activity</th>
              <th className="py-1 pr-3 font-medium">Reminders</th>
              <th className="py-1 pr-3 font-medium">Latest label</th>
              <th className="py-1 pr-3 font-medium">First-try scores</th>
              <th className="py-1 pr-3 font-medium">Trend</th>
              <th className="py-1 pr-3 font-medium">Repeats</th>
              <th className="py-1 pr-3 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {progress.map((p) => (
              <tr key={p.va.id} className="border-b border-foreground/10 align-top">
                <td className="py-1 pr-3">
                  <a href={`#va-${p.va.id}`} className="underline">
                    {p.va.full_name || p.va.email}
                  </a>
                </td>
                <td className="py-1 pr-3">{p.va.office_id ? (officeName.get(p.va.office_id) ?? "Unknown office") : "No office"}</td>
                <td className="py-1 pr-3">{p.current}</td>
                <td className="py-1 pr-3">{activityText(reminderOf.get(p.va.id))}</td>
                <td
                  className={`py-1 pr-3 ${
                    reminderOf.get(p.va.id)?.state === "overdue"
                      ? "font-medium text-red-700 dark:text-red-400"
                      : reminderOf.get(p.va.id)?.state === "behind"
                        ? "text-amber-700 dark:text-amber-300"
                        : ""
                  }`}
                >
                  {remindersText(reminderOf.get(p.va.id))}
                </td>
                <td className={`py-1 pr-3 font-medium ${LABEL_TONE[p.latest?.result ?? ""] ?? ""}`}>
                  {p.latest ? `${p.latest.schedule_day}: ${resultLabel(p.latest.result)}` : "–"}
                </td>
                <td className="py-1 pr-3">{p.scores.join(", ") || "–"}</td>
                <td className="py-1 pr-3">{p.trend}</td>
                <td className="py-1 pr-3">{p.repeats}</td>
                <td className={`py-1 pr-3 ${p.flags.length ? "text-red-700 dark:text-red-400" : ""}`}>{p.flags.join(", ") || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Certifications</h2>
          <Link href="/admin/sops" className="text-sm underline">
            SOPs to confirm
          </Link>
        </div>
        <CertGrid columns={grid.columns} rows={grid.rows} certificatePath={(id) => `/admin/vas/${id}/certificate`} />
      </section>

      {sortedVas.map((va) => {
        const reminder = reminderOf.get(va.id);
        const days = (unlocks.data ?? [])
          .filter((u) => u.va_id === va.id && u.office_id === va.office_id)
          .sort((a, b) => (order[a.schedule_day] ?? 99) - (order[b.schedule_day] ?? 99));
        const mine = attemptRows.filter((a) => a.va_id === va.id && a.office_id === va.office_id);
        const proofRows = (proofs.data ?? []).filter((p) => p.va_id === va.id && p.office_id === va.office_id);
        const taken = (dayAttempts.data ?? []).filter((a) => a.va_id === va.id && a.office_id === va.office_id);
        const resettable = taken.filter((a) => !a.archived_at);
        const resets = taken.filter((a) => a.archived_at);
        return (
          <section key={va.id} id={`va-${va.id}`} className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
            <div>
              <h2 className="text-lg font-semibold">{va.full_name || va.email}</h2>
              <p className="text-sm text-foreground/60">
                {va.email} · {va.office_id ? (officeName.get(va.office_id) ?? "Unknown office") : "No office"}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <StartDateForm vaId={va.id} value={va.va_start_date} />
              <p className="text-xs text-foreground/60">
                {sinceStartText(va.va_start_date, todayIn(process.env.TRAINING_TIME_ZONE || "America/New_York"))}. Reports
                only: a day opens when its cards are done, the previous quiz is submitted and VFDA approved it.
              </p>
            </div>

            {reminder && (
              <p className="text-sm">
                <span className="font-medium">Last activity: </span>
                {reminder.activity.lastActivity} ({activityText(reminder)}) · <span className="font-medium">Reminders: </span>
                {remindersText(reminder)}
                {reminder.anchor && <span className="text-foreground/70"> ({reminder.anchor.reason})</span>}
              </p>
            )}
            <p className="text-sm">
              <span className="font-medium">Role: </span>
              {scopeText(normalizeScope(va.va_scope))}
            </p>
            <p className="text-sm">
              <span className="font-medium">Days: </span>
              {days.length
                ? days
                    .map(
                      (d) =>
                        `${d.schedule_day} ${STATUS_LABELS[unlockStatus(d.status)]}${
                          unlockStatus(d.status) === "locked" && d.cards_done_at
                            ? d.prep_notified_at
                              ? ", cards done, waiting for VFDA approval"
                              : ", cards done"
                            : ""
                        }`,
                    )
                    .join(" · ")
                : "not started"}
              {outOfRole(va, days.filter((d) => unlockStatus(d.status) !== "locked").map((d) => d.schedule_day)).map((code) => (
                <span key={code} className="text-foreground/60">
                  {" · "}
                  {code} Not in this VA&apos;s role
                </span>
              ))}
            </p>

            {mine.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-foreground/15 text-foreground/60">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Day</th>
                      <th className="py-1 pr-3 font-medium">First try</th>
                      <th className="py-1 pr-3 font-medium">Label</th>
                      <th className="py-1 pr-3 font-medium">Repeat scores</th>
                      <th className="py-1 pr-3 font-medium">Time</th>
                      <th className="py-1 pr-3 font-medium">Flags</th>
                      <th className="py-1 pr-3 font-medium">Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((a) => {
                      const its = (items ?? []).filter((i) => i.attempt_id === a.id);
                      const repeats = its.filter((i) => i.repeat_scenario_id);
                      const flags = [
                        a.fast_finish && "fast finish",
                        its.some((i) => i.fast) && `${its.filter((i) => i.fast).length} fast items`,
                        a.critical_errors > 0 && `${a.critical_errors} critical`,
                        Array.isArray(a.paste_log) && a.paste_log.length > 0 && `${a.paste_log.length} pastes`,
                        repeats.length > 0 &&
                          `${repeats.length} repeated (${repeats.filter((i) => i.repeat_score !== 2).length} still below 2/2)`,
                        its.some((i) => !i.vfda_override && i.ai_confidence !== null && Number(i.ai_confidence) < 0.7) && "low-confidence grade",
                        its.some((i) => !i.vfda_override && i.first_score === null) && "item needs review",
                      ].filter(Boolean);
                      return (
                        <tr key={a.id} className="border-b border-foreground/10 align-top">
                          <td className="py-1 pr-3">
                            {attemptLabel(a)} <AttemptLink id={a.id} area="admin" />
                          </td>
                          <td className="py-1 pr-3">
                            {a.kind === "retake" && "retake "}
                            {Number(a.first_try_points)}/{a.max_points} ({percentOf(a.first_try_points, a.max_points)}%)
                            {a.kind === "retake" &&
                              (() => {
                                // The first try stays the official score.
                                const first = attemptRows.find((x) => x.id === a.parent_attempt_id);
                                return first ? ` · first try ${Number(first.first_try_points)}/${first.max_points} (${percentOf(first.first_try_points, first.max_points)}%)` : "";
                              })()}
                          </td>
                          <td className={`py-1 pr-3 font-medium ${LABEL_TONE[a.result ?? ""] ?? ""}`}>{resultLabel(a.result)}</td>
                          <td className="py-1 pr-3">
                            {repeats
                              .sort((x, y) => x.position - y.position)
                              .map((i) => `${i.first_score ?? "–"}→${i.repeat_score ?? "–"}`)
                              .join(", ") || "–"}
                          </td>
                          <td className="py-1 pr-3">{minutes(a.time_spent)}</td>
                          <td className="py-1 pr-3">{flags.join(", ") || "–"}</td>
                          <td className="py-1 pr-3">
                            <ReportStatus attemptId={a.id} rows={(notes ?? []).filter((n) => n.attempt_id === a.id)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {taken.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-dashed border-foreground/25 p-3 text-sm">
                <h3 className="font-medium">Test tools</h3>
                <p className="text-foreground/70">
                  Reset day (test): archives this VA&rsquo;s attempt (kept, no longer counted in scores or reports) and lets them
                  take the day again on the live version. Logged to the{" "}
                  <Link href="/admin/logs" className="underline">
                    System log
                  </Link>
                  .
                </p>
                {resettable.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {resettable.map((a) => (
                      <span key={a.id} className="inline-flex flex-wrap items-center gap-2">
                        <span>
                          {a.schedule_day} (version {a.build_version ?? 1}, {a.submitted_at ? "finished" : "in progress"})
                        </span>
                        <ActionButton action={resetDay.bind(null, va.id, a.schedule_day)} label="Reset day (test)" pendingLabel="Resetting…" />
                      </span>
                    ))}
                  </div>
                )}
                {resets.length > 0 && (
                  <ul className="text-foreground/70">
                    {resets.map((a) => (
                      <li key={a.id}>
                        {a.schedule_day} version {a.build_version ?? 1}: reset by {a.archived_by ? (emailOf.get(a.archived_by) ?? "VFDA") : "VFDA"} on{" "}
                        {new Date(a.archived_at!).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} (archived)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {proofRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">Proof of work</h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {proofRows.map((p) => {
                    const href = p.link_url ?? (p.file_path ? urlOf.get(p.file_path) : undefined);
                    return (
                      <li key={p.id} className="flex flex-col gap-1">
                        <span>
                          {p.schedule_day} ·{" "}
                          {href ? (
                            <a href={href} target="_blank" rel="noreferrer" className="underline">
                              {p.link_url ?? p.file_name ?? "file"}
                            </a>
                          ) : (
                            (p.file_name ?? "file")
                          )}{" "}
                          · {p.status}
                          {p.review_note && ` · "${p.review_note}"`}
                        </span>
                        {p.status === "pending" && <ProofReview proofId={p.id} />}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

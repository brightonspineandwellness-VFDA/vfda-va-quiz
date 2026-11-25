import "server-only";

// The weekly summary (Sunday night, src/app/api/cron/weekly): one email per VA
// in quiz training to each doctor of the office and to VFDA: the days
// completed this week with each day's label, the top skills shown, the top
// skills to practice (with their cards), and what's next. Never a score for
// doctors; VFDA's copy adds the scores, marked "VFDA only". The VA gets a
// short, encouraging version: skills shown and what to practice.
//
// "In quiz training": an active VA with scheduled days who hasn't finished
// them all, or finished the last of them this week. Every send is a
// notifications row (va_id, event weekly:<Sunday>), so nothing goes twice.

import { GOAL, loadCallsFor, passRateText, summarize } from "@/lib/call-practice/progress";
import { escapeHtml } from "@/lib/report";
import { appUrl, deliver, officeDoctors, sendEmail, tryTwice, vfdaEmails, type Target } from "@/lib/reports";
import { skillsOf } from "@/lib/skills";
import { createAdminClient } from "@/lib/supabase/server";
import { loadVaPath, progressOf, type VaPath } from "@/lib/training-progress";
import { percentOf, progressText, resultLabel } from "@/lib/va-flow";
import { localDate, sundayText, weekOf, zoneOf } from "@/lib/week";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "your VA";

export type WeeklySummary = {
  vaId: string;
  vaName: string;
  vaEmail: string | null;
  officeId: string;
  officeName: string;
  sunday: string;
  days: { code: string; title: string; label: string; score: string }[];
  skills: string[]; // top skills shown
  practice: string[]; // top skills to practice, each "... Review: <card>."
  progress: { done: number; total: number };
  next: string; // what's next
  // Call practice (only when the VA has made practice calls). Added beside the
  // quiz parts; the quiz lines are unchanged.
  calls?: { weekFinished: number; weekPassed: number; easy: string; challenging: string };
};

// Most frequent first, then first seen.
function top(lines: string[], n: number) {
  const count = new Map<string, number>();
  for (const l of lines) count.set(l, (count.get(l) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([l]) => l);
}

// One VA's week, or null when they aren't in quiz training.
export async function buildWeeklySummary(
  db: Db,
  va: { id: string; full_name: string | null; email: string | null; office_id: string },
  office: { id: string; name: string; time_zone?: string | null },
  sunday: string,
  path?: VaPath,
): Promise<WeeklySummary | null> {
  const p = path ?? (await loadVaPath(db, va.id, office.id));
  if (!p.path.length) return null;
  const tz = zoneOf(office.time_zone);
  const week = weekOf(sunday);
  const inWeek = (ts: string) => {
    const d = localDate(tz, ts);
    return d >= week.from && d <= week.to;
  };
  const progress = progressOf(p);
  const thisWeek = p.path.flatMap((d) => {
    const a = p.firstTry.get(d.code);
    return a && inWeek(a.submitted_at) ? [{ day: d, attempt: a }] : [];
  });
  const started = progress.done > 0;
  const finished = progress.done >= progress.total;
  // Not started, or done before this week: not in quiz training.
  if (!started || (finished && !thisWeek.length)) return null;

  const ids = thisWeek.map((x) => x.attempt.id);
  const read = (cols: string) => db.from("va_reports").select(cols).in("attempt_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  let res = await read("attempt_id, tips, strengths, skills");
  if (res.error && /skills/.test(res.error.message)) res = await read("attempt_id, tips, strengths");
  const reports = (must(res) ?? []) as unknown as { tips: unknown; strengths: unknown; skills?: unknown }[];
  const skills = top(
    reports.flatMap((r) => skillsOf({ skills: list(r.skills), strengths: list(r.strengths) }).flatMap((g) => g.bullets)),
    6,
  );
  const practice = top(
    reports.flatMap((r) => list(r.tips)),
    4,
  );
  const nextDay = p.path.find((d) => !p.firstTry.has(d.code));
  const callRows = await loadCallsFor(db, { vaIds: [va.id] }).catch(() => []);
  const callsAll = summarize(callRows);
  const weekCalls = summarize(callRows.filter((c) => c.finished_at && inWeek(c.finished_at)));
  const weekFinished = weekCalls.easy.finished + weekCalls.challenging.finished;
  const calls =
    callsAll.easy.finished + callsAll.challenging.finished > 0
      ? {
          weekFinished,
          weekPassed: weekCalls.easy.passed + weekCalls.challenging.passed,
          easy: `${Math.min(callsAll.easy.finished, GOAL)} of ${GOAL} easy calls (${passRateText(callsAll.easy)})`,
          challenging: `${Math.min(callsAll.challenging.finished, GOAL)} of ${GOAL} challenging calls (${passRateText(callsAll.challenging)})`,
        }
      : undefined;
  const name = va.full_name?.trim() || va.email || "VA";
  return {
    vaId: va.id,
    vaName: name,
    vaEmail: va.email,
    officeId: office.id,
    officeName: office.name,
    sunday,
    days: thisWeek.map(({ day, attempt }) => ({
      code: day.code,
      title: day.title,
      label: resultLabel(attempt.result),
      score: `${Number(attempt.first_try_points ?? 0)}/${attempt.max_points ?? 0} (${percentOf(attempt.first_try_points, attempt.max_points)}%)${attempt.critical_errors ? `, ${attempt.critical_errors} critical` : ""}`,
    })),
    skills,
    practice,
    progress,
    calls,
    next: nextDay
      ? `Next: ${nextDay.code} ${nextDay.title}.`
      : `All quiz days are done. ${firstName(name)}'s 4-week training program is being built; the first sheets arrive next Sunday night.`,
  };
}

type Audience = "doctor" | "vfda" | "va";

const callLine = (c: NonNullable<WeeklySummary["calls"]>) =>
  c.weekFinished ? `${c.weekFinished} practice call${c.weekFinished === 1 ? "" : "s"} this week, ${c.weekPassed} passed.` : "No practice calls this week.";
const callHtml = (c: NonNullable<WeeklySummary["calls"]>) =>
  [callLine(c), c.easy, c.challenging].map(escapeHtml).join("<br>");
const callText = (c: NonNullable<WeeklySummary["calls"]>) => `Call practice:\n- ${[callLine(c), c.easy, c.challenging].join("\n- ")}`;

// The email for one audience: subject, HTML and text.
export function weeklyEmail(s: WeeklySummary, audience: Audience) {
  const first = firstName(s.vaName);
  const e = escapeHtml;
  const week = `the week ending ${sundayText(s.sunday)}`;
  if (audience === "va") {
    const lines = [
      `Hi ${first},`,
      s.days.length
        ? `Nice work this week! You completed ${s.days.length} training day${s.days.length === 1 ? "" : "s"} (${progressText(s.progress)}).`
        : `A new week is a fresh start. You're at ${progressText(s.progress).toLowerCase()}.`,
    ];
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines.map((l) => `<p>${e(l)}</p>`).join("")}${
      s.skills.length ? `<p><b>Skills you showed</b><br>${s.skills.map((k) => `&#10003; ${e(k)}`).join("<br>")}</p>` : ""
    }${s.practice.length ? `<p><b>What to practice</b></p><ul>${s.practice.map((k) => `<li>${e(k)}</li>`).join("")}</ul>` : ""}${
      s.calls ? `<p><b>Call practice</b><br>${callHtml(s.calls)}</p>` : ""
    }<p>${e(s.next)}</p><p>Keep it up!</p></div>`;
    const text = [
      ...lines,
      s.skills.length ? `Skills you showed:\n${s.skills.map((k) => `- ${k}`).join("\n")}` : "",
      s.practice.length ? `What to practice:\n${s.practice.map((k) => `- ${k}`).join("\n")}` : "",
      s.calls ? callText(s.calls) : "",
      s.next,
      "Keep it up!",
    ]
      .filter(Boolean)
      .join("\n\n");
    return { subject: `Your week in training: ${s.days.length} day${s.days.length === 1 ? "" : "s"} completed`, html, text };
  }
  const vfda = audience === "vfda";
  const dayRow = (d: WeeklySummary["days"][number]) => `${d.code} ${d.title}: Completed ✓, ${d.label}${vfda ? ` · ${d.score} (VFDA only)` : ""}`;
  const subject = `${s.vaName}'s week in training: ${s.days.length} day${s.days.length === 1 ? "" : "s"} completed – ${s.officeName}`;
  const intro = `Here's ${first}'s week in quiz training (${week}). ${progressText(s.progress)}.`;
  const link = vfda ? `${appUrl()}/admin/vas` : `${appUrl()}/doctor/va`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">
${vfda ? `<p style="margin:0 0 12px;padding:6px 12px;background:#eef1f5;color:#374151;font-size:12px">VFDA copy: scores are VFDA only. Doctors get the same summary without scores.</p>` : ""}
<p>${e(intro)}</p>
<h3 style="margin:16px 0 6px;font-size:15px">Days completed this week</h3>
${s.days.length ? `<ul>${s.days.map((d) => `<li>${e(dayRow(d))}</li>`).join("")}</ul>` : `<p>No training days this week.</p>`}
${s.skills.length ? `<h3 style="margin:16px 0 6px;font-size:15px;color:#166534">Top skills ${e(first)} showed</h3><p>${s.skills.map((k) => `&#10003; ${e(k)}`).join("<br>")}</p>` : ""}
${s.practice.length ? `<h3 style="margin:16px 0 6px;font-size:15px">Top skills to practice</h3><ul>${s.practice.map((k) => `<li>${e(k)}</li>`).join("")}</ul>` : ""}
${s.calls ? `<h3 style="margin:16px 0 6px;font-size:15px">Call practice</h3><p>${callHtml(s.calls)}</p>` : ""}
<h3 style="margin:16px 0 6px;font-size:15px">What's next</h3><p>${e(s.next)}</p>
<p><a href="${e(link)}">Open in the app</a> (sign-in required)</p>
</div>`;
  const text = [
    vfda ? "VFDA copy: scores are VFDA only." : "",
    intro,
    `Days completed this week:\n${s.days.length ? s.days.map((d) => `- ${dayRow(d)}`).join("\n") : "None"}`,
    s.skills.length ? `Top skills ${first} showed:\n${s.skills.map((k) => `- ${k}`).join("\n")}` : "",
    s.practice.length ? `Top skills to practice:\n${s.practice.map((k) => `- ${k}`).join("\n")}` : "",
    s.calls ? callText(s.calls) : "",
    `What's next: ${s.next}`,
    `Open in the app: ${link}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject: vfda ? `[VFDA] ${subject}` : subject, html, text };
}

// Every VA's summary for one office and Sunday, sent once each.
export async function sendWeeklySummaries(db: Db, office: { id: string; name: string; time_zone?: string | null }, sunday: string) {
  const vas = (must(
    await db.from("profiles").select("id, full_name, email, office_id").eq("role", "va").eq("office_id", office.id).is("deactivated_at", null),
  ) ?? []) as { id: string; full_name: string | null; email: string | null; office_id: string }[];
  const doctors = await officeDoctors(db, office.id);
  const vfda = [...new Set(vfdaEmails().map((x) => x.toLowerCase()))];
  let sent = 0;
  let failed = 0;
  let summaries = 0;
  for (const va of vas) {
    const s = await buildWeeklySummary(db, va, office, sunday);
    if (!s) continue;
    summaries++;
    const mail = (to: string, audience: Audience): Target => {
      const m = weeklyEmail(s, audience);
      return { channel: "email", recipient: to, send: () => sendEmail(to, m.subject, m.html, m.text, `weekly-${va.id}-${sunday}-${to}`) };
    };
    const r = await deliver(db, { va_id: va.id, event: `weekly:${sunday}` }, [
      ...doctors.emails.map((to) => mail(to, "doctor")),
      ...vfda.map((to) => mail(to, "vfda")),
      ...(va.email ? [mail(va.email.toLowerCase(), "va")] : []),
    ]);
    sent += r.sent;
    failed += r.failed;
  }
  return { summaries, sent, failed };
}

// "Send this week now (test email)": one VA's three versions to one address, marked [TEST]. Not recorded.
export async function sendWeeklyTest(db: Db, vaId: string, to: string, sunday: string): Promise<string | null> {
  const va = must(await db.from("profiles").select("id, full_name, email, office_id").eq("id", vaId).maybeSingle()) as {
    id: string;
    full_name: string | null;
    email: string | null;
    office_id: string | null;
  } | null;
  if (!va?.office_id) return "This VA has no office.";
  const office = must(await db.from("offices").select("id, name, time_zone").eq("id", va.office_id).maybeSingle()) as {
    id: string;
    name: string;
    time_zone: string | null;
  } | null;
  if (!office) return "Office not found.";
  const s = await buildWeeklySummary(db, { ...va, office_id: office.id }, office, sunday);
  if (!s) return "This VA isn't in quiz training (not started, or finished before this week): no weekly summary.";
  for (const audience of ["doctor", "vfda", "va"] as Audience[]) {
    const m = weeklyEmail(s, audience);
    const error = await tryTwice(() => sendEmail(to, `[TEST ${audience}] ${m.subject}`, m.html, m.text, `test-weekly-${vaId}-${audience}-${Date.now()}`));
    if (error) return error;
  }
  return null;
}

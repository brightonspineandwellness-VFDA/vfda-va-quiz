import "server-only";

// The Friday weekly summary (src/lib/weekly-summary-pdf.ts): one PDF per VA
// who took a quiz in the last 7 days, stored at
// quiz-reports/<office>/<va>/weekly/<date>.pdf and sent to every doctor of
// the office through Leads4Life (report_type "weekly_summary", permanent
// link), plus a Slack line to VFDA. Sent by the daily cron on Fridays; one
// notifications row per recipient (va_id, event weekly:<date>), so it goes
// out once. No AI: it's built from the week's graded items and VA reports.

import { cardsTested as cardsOf, type DoneWellItem, type NeedsWorkItem } from "@/lib/quiz-report";
import { loadItems, QUIZ_REPORT_BUCKET } from "@/lib/quiz-reports";
import { permanentReportLink } from "@/lib/report-links";
import { slackEscape } from "@/lib/report";
import { deliver, LEADS4LIFE, officeDoctors, postLeads4Life, postSlack, SLACK_RECIPIENT, type Target } from "@/lib/reports";
import { standardsUsed } from "@/lib/rule-source";
import { createAdminClient } from "@/lib/supabase/server";
import { percentOf, RESULT_LABELS, todayIn, type ResultLabel } from "@/lib/va-flow";
import { weeklySummaryPdf, type WeeklySummary } from "@/lib/weekly-summary-pdf";

type Db = ReturnType<typeof createAdminClient>;
const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";
const MAX_STRENGTHS = 6;
const MAX_PRACTICE = 5;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const showDay = (iso: string, year = false) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

// The 7 days before `today` (the cron runs Friday morning: last Friday to Thursday).
export function weekOf(today: string) {
  const from = shiftDate(today, -7);
  const to = shiftDate(today, -1);
  return { from, to, label: `${showDay(from)} – ${showDay(to, true)}` };
}

type AttemptRow = {
  id: string;
  kind: string;
  schedule_day: string;
  first_try_points: number | null;
  max_points: number | null;
  result: string | null;
  submitted_at: string;
};

// The week's summary for one VA; null when they took no quiz that week.
export async function buildWeeklySummary(db: Db, vaId: string, today = todayIn(TIME_ZONE)): Promise<{ summary: WeeklySummary; officeId: string } | null> {
  const va = must(await db.from("profiles").select("full_name, email, office_id").eq("id", vaId).maybeSingle()) as {
    full_name: string | null;
    email: string | null;
    office_id: string | null;
  } | null;
  if (!va?.office_id) return null;
  const officeId = va.office_id;
  const week = weekOf(today);
  const [office, attempts, days, doctors] = await Promise.all([
    db.from("offices").select("name").eq("id", officeId).maybeSingle(),
    db
      .from("attempts")
      .select("id, kind, schedule_day, first_try_points, max_points, result, submitted_at")
      .eq("va_id", vaId)
      .eq("office_id", officeId)
      .in("kind", ["day", "retake"])
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at"),
    db.from("schedule_days").select("code, title"),
    officeDoctors(db, officeId),
  ]);
  const all = (must(attempts) ?? []) as AttemptRow[];
  const dateOf = (ts: string) => todayIn(TIME_ZONE, new Date(ts));
  const mine = all.filter((a) => dateOf(a.submitted_at) >= week.from && dateOf(a.submitted_at) <= week.to);
  if (!mine.length) return null;
  const titles = new Map(((must(days) ?? []) as { code: string; title: string }[]).map((d) => [d.code, d.title]));

  const needsWork: NeedsWorkItem[] = [];
  const doneWell: DoneWellItem[] = [];
  for (const a of mine) {
    const items = await loadItems(db, a.id);
    needsWork.push(...items.needsWork);
    doneWell.push(...items.doneWell);
  }
  const reports = (must(await db.from("va_reports").select("attempt_id, strengths").in("attempt_id", mine.map((a) => a.id))) ?? []) as {
    attempt_id: string;
    strengths: unknown;
  }[];
  const strengths = [
    ...new Set(reports.flatMap((r) => (Array.isArray(r.strengths) ? r.strengths.map((s) => String(s).replace(/^\[[^\]]+\]\s*/, "").trim()) : []))),
  ]
    .filter(Boolean)
    .slice(0, MAX_STRENGTHS);

  // The steps that came up most often below full points, with their card.
  const counts = new Map<string, { text: string; n: number }>();
  for (const i of needsWork) {
    const card = i.sourceCard?.trim() || `${i.workflowName} card`;
    for (const step of (i.missed.length ? i.missed : i.critical ? i.correct.slice(0, 1) : []).slice(0, 2)) {
      const text = `${step.trim().replace(/[.\s]+$/, "")} (${card})`;
      const key = text.toLowerCase();
      counts.set(key, { text, n: (counts.get(key)?.n ?? 0) + 1 });
    }
  }
  const practice = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, MAX_PRACTICE).map((c) => c.text);

  return {
    officeId,
    summary: {
      vaName: va.full_name?.trim() || va.email || "VA",
      officeName: ((must(office) as { name: string } | null)?.name ?? "Office") as string,
      doctors: doctors.primary ? [doctors.primary, ...doctors.list.map((d) => d.name).filter((n) => n !== doctors.primary)] : doctors.list.map((d) => d.name),
      weekLabel: week.label,
      days: mine.map((a) => ({
        code: a.schedule_day,
        topic: titles.get(a.schedule_day) ?? "",
        result: a.result && a.result in RESULT_LABELS ? RESULT_LABELS[a.result as ResultLabel] : "–",
        percent: percentOf(a.first_try_points, a.max_points),
        retake: a.kind === "retake",
      })),
      totalDone: new Set(all.filter((a) => a.kind === "day" && dateOf(a.submitted_at) <= week.to).map((a) => a.schedule_day)).size,
      strengths,
      cardsTested: cardsOf(needsWork, doneWell),
      standards: standardsUsed([...needsWork, ...doneWell].map((i) => i.ruleSource)),
      practice,
    },
  };
}

// The PDF, stored (replacing any copy for the same date); its permanent link.
export async function makeWeeklySummary(db: Db, vaId: string, today = todayIn(TIME_ZONE)) {
  const built = await buildWeeklySummary(db, vaId, today);
  if (!built) return null;
  const bytes = await weeklySummaryPdf(built.summary);
  const path = `${built.officeId}/${vaId}/weekly/${today}.pdf`;
  const { error } = await db.storage.from(QUIZ_REPORT_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`The weekly summary couldn't be stored: ${error.message}`);
  return { ...built, bytes, path, link: permanentReportLink(path) };
}

// Fridays (the daily cron): every active VA who took a quiz this week.
export async function sendWeeklySummaries(now = new Date()) {
  const db = createAdminClient();
  const today = todayIn(TIME_ZONE, now);
  if (new Date(`${today}T12:00:00Z`).getUTCDay() !== 5) return { today, skipped: "not Friday" };
  const week = weekOf(today);
  const since = new Date(`${shiftDate(week.from, -1)}T00:00:00Z`).toISOString();
  const recent = (must(
    await db.from("attempts").select("va_id").in("kind", ["day", "retake"]).gte("submitted_at", since).is("archived_at", null),
  ) ?? []) as { va_id: string }[];
  const active = new Set(
    ((must(await db.from("profiles").select("id").eq("role", "va").is("deactivated_at", null)) ?? []) as { id: string }[]).map((p) => p.id),
  );
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const vaId of [...new Set(recent.map((r) => r.va_id))].filter((id) => active.has(id))) {
    try {
      const r = await sendWeeklySummary(db, vaId, today);
      sent += r.sent;
      failed += r.failed;
    } catch (e) {
      failed++;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { today, sent, failed, errors };
}

export async function sendWeeklySummary(db: Db, vaId: string, today: string) {
  const made = await makeWeeklySummary(db, vaId, today);
  if (!made) return { sent: 0, failed: 0 };
  const { summary: s, link } = made;
  const doctors = await officeDoctors(db, made.officeId);
  const subject = `${s.vaName}'s weekly training summary`;
  const leads4life = (d: { email: string; name: string }): Target => ({
    channel: LEADS4LIFE,
    recipient: d.email,
    send: () =>
      postLeads4Life(
        {
          doctor_email: d.email,
          doctor_name: d.name,
          office: s.officeName,
          va_name: s.vaName,
          day: "Weekly summary",
          topic: s.weekLabel,
          result: "",
          first_try_score: "",
          raw_score: "",
          is_retake: "no",
          report_link: link,
          critical_errors: 0,
          flags: "none",
          email_subject: subject,
          report_type: "weekly_summary",
        },
        `weekly-${vaId}-${today}-${d.email}`,
      ),
  });
  return deliver(db, { va_id: vaId, event: `weekly:${today}` }, [
    {
      channel: "slack",
      recipient: SLACK_RECIPIENT,
      send: () =>
        postSlack({
          text: `*${slackEscape(subject)}* (${slackEscape(s.officeName)}, ${slackEscape(s.weekLabel)}): ${s.days.length} quiz${s.days.length === 1 ? "" : "zes"}, ${s.standards.length} VFDA standard${s.standards.length === 1 ? "" : "s"} not on their cards yet.\n<${link}|Weekly summary PDF>`,
        }),
    },
    ...doctors.list.map(leads4life),
  ]);
}

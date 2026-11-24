import "server-only";

// Every active VA's release schedule (src/lib/release-schedule.ts), for VA
// progress, and the morning emails, sent by the daily cron (/api/cron/recheck)
// on weekdays (office time). They replace the old behind / overdue reminders:
//
// - The VA, on the morning a quiz is released: "Your W1D3 quiz is ready:
//   <topic>". With Late quizzes, it says how many to do (the oldest first).
//   A Late VA with nothing released that morning gets "You have N quizzes
//   to do".
// - VFDA, one digest (email + Slack) listing every Late VA and how many days
//   behind.
// - 2 or more days behind: the office's doctors and VFDA, "<VA> is <n> days
//   behind on training", at most once a day.
//
// Paused VAs, VAs waiting for VFDA to approve their next day and VAs who
// finished are left out. Every email is a notifications row (va_id + event
// with the day or date), so a second run never sends twice.

import { appUrl, deliver, officeDoctors, postSlack, sendEmail, SLACK_RECIPIENT, tryTwice, vfdaEmails, type Target } from "@/lib/reports";
import { escapeHtml, slackEscape } from "@/lib/report";
import {
  isPaused,
  officeToday,
  releaseDateText,
  releaseTimeText,
  scheduleSettings,
  scheduleSummary,
  type DaySchedule,
  type ScheduleSettings,
} from "@/lib/release-schedule";
import { createAdminClient } from "@/lib/supabase/server";
import { buildToday, officeProfile, pathSchedule, trainingPath, type DayRow, type OfficeFlags, type Today, type UnlockRow } from "@/lib/va-flow";
import { normalizeScope } from "@/lib/va-scope";
import { weekdayOf, zoneOf } from "@/lib/week";

type Db = ReturnType<typeof createAdminClient>;
const DAY_COLUMNS = "code, week, day, title, cards, condition, max_points, pass_points, review_min_points, answer_format, proof_of_work";

// Doctors are told about Late days released from this date on, so turning
// the schedule on doesn't alert them about days that were due before it.
export const DOCTOR_ALERTS_FROM = "2026-11-25";

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export type VaSchedule = {
  vaId: string;
  name: string;
  email: string | null;
  officeId: string;
  officeName: string;
  timeZone: string;
  startDate: string | null;
  settings: ScheduleSettings;
  paused: boolean;
  schedule: DaySchedule[];
  titles: Map<string, string>;
  today: Today;
  released: number;
  total: number;
  late: DaySchedule[];
  // "Day 6 of 10 released · 2 late"
  summary: string;
};

// Every active VA's schedule. `now` for tests.
export async function loadScheduleBoard(db: Db, now = new Date()): Promise<VaSchedule[]> {
  const [vas, offices, days, settings, scenarios, officeDays, unlocks] = await Promise.all([
    // "*": release_schedule only exists once release-schedule.sql has been run.
    db.from("profiles").select("*").eq("role", "va").is("deactivated_at", null).not("office_id", "is", null),
    db.from("offices").select("id, name, time_zone, bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool"),
    db.from("schedule_days").select(DAY_COLUMNS),
    db.from("settings").select("key, value").in("key", ["conditions", "sequence"]),
    // Every built day ("*": title only exists once practice-days.sql has been run).
    db.from("office_days").select("*"),
    db.from("office_days").select("office_id, schedule_day, live_version").not("live_version", "is", null),
    db.from("day_unlocks").select("va_id, office_id, schedule_day, version, status, cards_done_at, unlocked_at"),
  ]);
  const settingRows = (must(settings) ?? []) as { key: string; value: unknown }[];
  const sequence = (settingRows.find((s) => s.key === "sequence")?.value as string[] | undefined) ?? [];
  const conditions = (settingRows.find((s) => s.key === "conditions")?.value as Record<string, string> | undefined) ?? {};
  const dayRows = (must(days) ?? []) as DayRow[];
  const titles = new Map(dayRows.map((d) => [d.code, d.title]));
  const officeRows = (must(offices) ?? []) as (OfficeFlags & { id: string; name: string; time_zone: string | null })[];
  const builtRows = (must(scenarios) ?? []) as { office_id: string; schedule_day: string; build_version: number | null; kind: string | null; title?: string | null }[];
  const liveRows = (must(officeDays) ?? []) as { office_id: string; schedule_day: string }[];
  const unlockRows = (must(unlocks) ?? []) as (UnlockRow & { va_id: string; office_id: string })[];

  const out: VaSchedule[] = [];
  for (const va of (must(vas) ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    office_id: string;
    va_start_date: string | null;
    va_scope: string[] | null;
    release_schedule?: unknown;
  }[]) {
    const office = officeRows.find((o) => o.id === va.office_id);
    if (!office) continue;
    const timeZone = zoneOf(office.time_zone);
    const mine = unlockRows.filter((u) => u.va_id === va.id && u.office_id === va.office_id);
    const path = trainingPath({
      sequence,
      days: dayRows,
      conditions,
      profile: officeProfile(office),
      officeScenarioDays: new Set(builtRows.filter((s) => s.office_id === va.office_id && s.build_version).map((s) => s.schedule_day)),
      officeDays: new Map(builtRows.filter((s) => s.office_id === va.office_id).map((s) => [s.schedule_day, s])),
      scope: normalizeScope(va.va_scope),
      started: new Set(mine.filter((u) => u.status !== "locked").map((u) => u.schedule_day)),
    });
    const settings_ = scheduleSettings(va.release_schedule);
    const schedule = pathSchedule({ path, unlocks: mine, startDate: va.va_start_date, timeZone, settings: settings_, now });
    const today = buildToday({
      path,
      unlocks: mine,
      approved: new Set(liveRows.filter((d) => d.office_id === va.office_id).map((d) => d.schedule_day)),
      schedule,
    });
    const s = scheduleSummary(schedule);
    out.push({
      vaId: va.id,
      name: va.full_name?.trim() || va.email || "VA",
      email: va.email,
      officeId: va.office_id,
      officeName: office.name,
      timeZone,
      startDate: va.va_start_date,
      settings: settings_,
      paused: isPaused(settings_),
      schedule,
      titles,
      today,
      released: s.released,
      total: s.total,
      late: schedule.filter((d) => d.late),
      summary: `${s.text}${isPaused(settings_) ? " · paused" : ""}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The morning emails (the daily cron)
// ---------------------------------------------------------------------------

const html = (lines: string[], link: string, label: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join("")}<p><a href="${escapeHtml(link)}">${escapeHtml(label)}</a></p></div>`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const quizzes = (n: number) => `${n} ${n === 1 ? "quiz" : "quizzes"}`;
const dayText = (v: VaSchedule, d: DaySchedule) => `${d.code}: ${v.titles.get(d.code) ?? d.code}`;

// Days the VA can be nagged about: not when paused, finished, or waiting for VFDA.
const waitingOnVa = (v: VaSchedule) => !v.paused && v.today.kind !== "finished" && v.today.kind !== "no_days" && v.today.kind !== "preparing";

function vaEmail(v: VaSchedule, releasedToday: DaySchedule | null, now: Date): Target | null {
  const to = v.email?.toLowerCase();
  if (!to) return null;
  const link = `${appUrl()}/va`;
  // Released quizzes not submitted, oldest first, plus today's.
  const todo = v.schedule.filter((d) => !d.done && (d.released || d === releasedToday));
  const lines = [`Hi ${v.name},`];
  let subject: string;
  if (releasedToday) {
    const notYet = !!releasedToday.releaseAt && now.getTime() < Date.parse(releasedToday.releaseAt);
    subject = notYet
      ? `Your ${releasedToday.code} quiz opens at ${releaseTimeText(v.timeZone).replace(" (office time)", "")} today: ${v.titles.get(releasedToday.code)}`
      : `Your ${releasedToday.code} quiz is ready: ${v.titles.get(releasedToday.code)}`;
    lines.push(
      notYet
        ? `Today's quiz, ${dayText(v, releasedToday)}, opens at ${releaseTimeText(v.timeZone)}.`
        : `Today's quiz is ready: ${dayText(v, releasedToday)}.`,
    );
  } else {
    subject = `You have ${quizzes(todo.length)} to do`;
  }
  if (todo.length > 1) {
    lines.push(
      `You have ${todo.length} quizzes to do. Take them in order: ${todo
        .map((d, i) => `${i === 0 ? "first " : ""}${dayText(v, d)}${d.late && d.releaseDate ? ` (released ${releaseDateText(d.releaseDate)})` : ""}`)
        .join(", then ")}.`,
    );
  } else if (!releasedToday && todo.length === 1) {
    lines.push(`Your ${dayText(v, todo[0])} quiz is waiting. Please take it today.`);
  }
  lines.push("Open Today, read the day's cards, mark them done, then start the quiz.");
  return {
    channel: "email",
    recipient: to,
    send: () => sendEmail(to, subject, html(lines, link, "Open Today"), `${lines.join("\n\n")}\n\nOpen Today: ${link}`, `schedule-${v.vaId}-${releasedToday?.code ?? "late"}-${officeToday(v.timeZone, now)}-${to}`),
  };
}

const vfdaLink = (v: VaSchedule) => `${appUrl()}/admin/vas#va-${v.vaId}`;
const lateLine = (v: VaSchedule) =>
  `${v.name} (${v.officeName}): ${plural(v.late.length, "day")} behind. Late: ${v.late.map((d) => d.code).join(", ")}. ${v.summary}.`;

// One digest to VFDA listing every Late VA. Each VA gets a row per channel
// (event late:<office date>), so each is in one digest a day.
async function lateDigest(db: Db, late: VaSchedule[], now: Date) {
  const link = `${appUrl()}/admin/vas?f=late`;
  const subject = `Late VAs today: ${late.length}`;
  const lines = late.map(lateLine);
  const event = (v: VaSchedule) => `late:${officeToday(v.timeZone, now)}`;
  const vfda = [...new Set(vfdaEmails().map((e) => e.toLowerCase()))];
  const targets: { channel: "email" | "slack"; recipient: string; send: () => Promise<void> }[] = [
    ...vfda.map((to) => ({
      channel: "email" as const,
      recipient: to,
      send: () =>
        sendEmail(
          to,
          subject,
          html(["These VAs have quizzes not submitted by the end of their release day:", ...lines], link, "VA progress"),
          `These VAs have quizzes not submitted by the end of their release day:\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\nVA progress: ${link}`,
          `late-digest-${now.toISOString().slice(0, 10)}-${late.map((v) => v.vaId).join(",")}-${to}`,
        ),
    })),
    {
      channel: "slack" as const,
      recipient: SLACK_RECIPIENT,
      send: () => postSlack({ text: [`*${slackEscape(subject)}*`, ...lines.map((l) => `• ${slackEscape(l)}`), `<${link}|VA progress>`].join("\n") }),
    },
  ];
  const { data: sentRows } = await db
    .from("notifications")
    .select("va_id, event, channel, recipient")
    .in("va_id", late.map((v) => v.vaId))
    .like("event", "late:%")
    .eq("status", "sent");
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    const fresh = late.filter(
      (v) => !(sentRows ?? []).some((r) => r.va_id === v.vaId && r.event === event(v) && r.channel === t.channel && r.recipient === t.recipient),
    );
    if (!fresh.length) continue;
    const rows = fresh.map((v) => ({ va_id: v.vaId, event: event(v), channel: t.channel, recipient: t.recipient }));
    must(await db.from("notifications").upsert(rows, { onConflict: "va_id,event,channel,recipient", ignoreDuplicates: true }).select("id"));
    const error = await tryTwice(t.send);
    for (const r of rows) {
      must(
        await db
          .from("notifications")
          .update(error === null ? { status: "sent", sent_at: new Date().toISOString(), error: null } : { status: "failed", error: error.slice(0, 500) })
          .match(r)
          .select("id"),
      );
    }
    if (error === null) sent++;
    else {
      console.error("Late digest not sent", t.channel, error);
      failed++;
    }
  }
  return { sent, failed };
}

// 2 or more days behind: the office's doctors and VFDA, once a day.
async function behindAlert(db: Db, v: VaSchedule, behind: number, now: Date) {
  const doctors = await officeDoctors(db, v.officeId);
  const subject = `${v.name} is ${behind} days behind on training`;
  const lines = [
    `${v.name} (${v.officeName}) has ${behind} quizzes not submitted by the end of their release day: ${v.late.map((d) => dayText(v, d)).join("; ")}.`,
    `One quiz is released each weekday at ${releaseTimeText(v.timeZone)}. ${v.summary}.`,
  ];
  const mail = (to: string, link: string, label: string): Target => ({
    channel: "email",
    recipient: to,
    send: () => sendEmail(to, subject, html(lines, link, label), `${lines.join("\n\n")}\n\n${label}: ${link}`, `behind-${v.vaId}-${officeToday(v.timeZone, now)}-${to}`),
  });
  return deliver(db, { va_id: v.vaId, event: `behind:${officeToday(v.timeZone, now)}` }, [
    ...doctors.emails.map((to) => mail(to, `${appUrl()}/doctor/va`, "Your VAs")),
    ...[...new Set(vfdaEmails().map((e) => e.toLowerCase()))].map((to) => mail(to, vfdaLink(v), "VA progress")),
  ]);
}

export async function runMorningEmails(now = new Date()) {
  const db = createAdminClient();
  const board = await loadScheduleBoard(db, now);
  let sent = 0;
  let failed = 0;
  const add = (r: { sent: number; failed: number }) => {
    sent += r.sent;
    failed += r.failed;
  };
  let released = 0;
  const late: VaSchedule[] = [];
  let behind = 0;
  for (const v of board) {
    const today = officeToday(v.timeZone, now);
    // No emails on weekends (office time).
    if ([0, 6].includes(weekdayOf(today)) || !waitingOnVa(v)) continue;
    // Today's release (a day released early isn't announced again).
    const releasedToday = v.schedule.find((d) => d.releaseDate === today && !d.early && !d.done) ?? null;
    // Only quizzes the VA can take: in order, so today's waits behind an
    // earlier one VFDA hasn't approved (left out above).
    if (releasedToday || v.late.length) {
      const email = vaEmail(v, releasedToday, now);
      if (email) {
        const r = await deliver(db, { va_id: v.vaId, event: releasedToday ? `release:${releasedToday.code}` : `late-va:${today}` }, [email]);
        add(r);
        if (releasedToday) released++;
      }
    }
    if (v.late.length) late.push(v);
    const counted = v.late.filter((d) => (d.releaseDate ?? "") >= DOCTOR_ALERTS_FROM).length;
    if (counted >= 2) {
      add(await behindAlert(db, v, v.late.length, now));
      behind++;
    }
  }
  if (late.length) add(await lateDigest(db, late, now));
  return { ran: now.toISOString(), released, late: late.length, behind, sent, failed };
}

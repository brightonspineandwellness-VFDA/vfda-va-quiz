import "server-only";

// Reminders for VAs who are behind (src/lib/reminder-rules.ts), sent by the
// daily cron (/api/cron/recheck) on business days. The first time: an email
// to the VA ("Your next quiz is waiting") and an email + Slack to VFDA.
// Still behind 2 business days later: the VA again, and VFDA one "overdue"
// alert listing every overdue VA. Deactivated VAs, VAs who finished all
// their days and VAs waiting for VFDA to approve their next day are left out.
// Every reminder is a notifications row (va_id, event behind:/overdue:<episode>).

import {
  activity,
  anchorOf,
  behindEvent,
  episode,
  isBusinessDay,
  overdueEvent,
  type Activity,
  type ReminderState,
} from "@/lib/reminder-rules";
import { appUrl, deliver, postSlack, sendEmail, SLACK_RECIPIENT, tryTwice, vfdaEmails, type Target } from "@/lib/reports";
import { escapeHtml, slackEscape } from "@/lib/report";
import { createAdminClient } from "@/lib/supabase/server";
import { buildToday, officeProfile, todayIn, trainingPath, attemptLabel, type DayRow, type OfficeFlags, type UnlockRow } from "@/lib/va-flow";
import { normalizeScope } from "@/lib/va-scope";

type Db = ReturnType<typeof createAdminClient>;
const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";
const DAY_COLUMNS = "code, week, day, title, cards, condition, max_points, pass_points, review_min_points, answer_format, proof_of_work";

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export type VaReminder = {
  vaId: string;
  name: string;
  email: string | null;
  officeId: string;
  officeName: string;
  // The next quiz ("W1D3: Phone basics"), null when there is none to nag about.
  next: string | null;
  activity: Activity;
  state: ReminderState;
  anchor: { key: string; reason: string } | null;
  remindedOn: string | null;
  // Reminders the VA was sent (emails that went out).
  remindersSent: number;
  // Every reminder row, for knowing what already went out.
  rows: { event: string; channel: string; recipient: string; status: string; created_at: string }[];
};

// Every active VA's activity and reminder state. `now` for tests.
export async function loadReminderBoard(db: Db, now = new Date()): Promise<VaReminder[]> {
  const today = todayIn(TIME_ZONE, now);
  const dateOf = (ts: string) => todayIn(TIME_ZONE, new Date(ts));
  const [vas, offices, days, settings, scenarios, officeDays, unlocks, attempts, notes] = await Promise.all([
    db
      .from("profiles")
      .select("id, full_name, email, office_id, va_start_date, va_scope, created_at")
      .eq("role", "va")
      .is("deactivated_at", null)
      .not("office_id", "is", null),
    db.from("offices").select("id, name, bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool"),
    db.from("schedule_days").select(DAY_COLUMNS),
    db.from("settings").select("key, value").in("key", ["conditions", "sequence"]),
    db.from("office_scenarios").select("office_id, schedule_day").eq("version", "A").eq("is_repeat_variant", false).limit(20000),
    db.from("office_days").select("office_id, schedule_day, live_version").not("live_version", "is", null),
    db.from("day_unlocks").select("va_id, office_id, schedule_day, version, status, cards_done_at, unlocked_at"),
    db.from("attempts").select("id, va_id, office_id, kind, schedule_day, started_at, submitted_at").is("archived_at", null),
    db.from("notifications").select("va_id, event, channel, recipient, status, created_at").not("va_id", "is", null),
  ]);
  const settingRows = (must(settings) ?? []) as { key: string; value: unknown }[];
  const sequence = (settingRows.find((s) => s.key === "sequence")?.value as string[] | undefined) ?? [];
  const conditions = (settingRows.find((s) => s.key === "conditions")?.value as Record<string, string> | undefined) ?? {};
  const dayRows = (must(days) ?? []) as DayRow[];
  const officeRows = (must(offices) ?? []) as (OfficeFlags & { id: string; name: string })[];
  const scenarioRows = (must(scenarios) ?? []) as { office_id: string; schedule_day: string }[];
  const liveRows = (must(officeDays) ?? []) as { office_id: string; schedule_day: string }[];
  const unlockRows = (must(unlocks) ?? []) as (UnlockRow & { va_id: string; office_id: string })[];
  const attemptRows = (must(attempts) ?? []) as {
    id: string;
    va_id: string;
    office_id: string;
    kind: string;
    schedule_day: string;
    started_at: string;
    submitted_at: string | null;
  }[];
  const noteRows = (must(notes) ?? []) as (VaReminder["rows"][number] & { va_id: string })[];

  const out: VaReminder[] = [];
  for (const va of (must(vas) ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    office_id: string;
    va_start_date: string | null;
    va_scope: string[] | null;
    created_at: string;
  }[]) {
    const office = officeRows.find((o) => o.id === va.office_id);
    if (!office) continue;
    const mine = unlockRows.filter((u) => u.va_id === va.id && u.office_id === va.office_id);
    const path = trainingPath({
      sequence,
      days: dayRows,
      conditions,
      profile: officeProfile(office),
      officeScenarioDays: new Set(scenarioRows.filter((s) => s.office_id === va.office_id).map((s) => s.schedule_day)),
      scope: normalizeScope(va.va_scope),
      started: new Set(mine.filter((u) => u.status !== "locked").map((u) => u.schedule_day)),
    });
    const today_ = buildToday({
      path,
      unlocks: mine,
      approved: new Set(liveRows.filter((d) => d.office_id === va.office_id).map((d) => d.schedule_day)),
    });
    const quizzes = attemptRows.filter((a) => a.va_id === va.id && a.office_id === va.office_id);
    const act = activity({
      now,
      today,
      dateOf,
      startDate: va.va_start_date,
      createdAt: va.created_at,
      cardsDone: mine.map((u) => u.cards_done_at).filter((t): t is string => !!t),
      submitted: quizzes.map((a) => a.submitted_at).filter((t): t is string => !!t),
      open: quizzes.filter((a) => !a.submitted_at).map((a) => ({ id: a.id, startedAt: a.started_at, label: attemptLabel(a) })),
    });
    const rows = noteRows.filter((n) => n.va_id === va.id);
    // Nothing to nag about: no days, all done, or waiting for VFDA to approve the next day.
    const eligible = today_.kind === "open" || today_.kind === "cards";
    const firstReminded = new Map<string, string>();
    for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (r.event.startsWith("behind:") && !firstReminded.has(anchorOf(r.event))) firstReminded.set(anchorOf(r.event), dateOf(r.created_at));
    }
    const ep = eligible ? episode(act.anchors, firstReminded, today) : { state: "ok" as ReminderState, anchor: null, remindedOn: null };
    out.push({
      vaId: va.id,
      name: va.full_name?.trim() || va.email || "VA",
      email: va.email,
      officeId: va.office_id,
      officeName: office.name,
      next: eligible ? `${today_.current.day.code}: ${today_.current.day.title}` : null,
      activity: act,
      state: ep.state,
      anchor: ep.anchor,
      remindedOn: ep.remindedOn,
      remindersSent: rows.filter((r) => r.channel === "email" && r.status === "sent" && r.recipient === va.email?.toLowerCase()).length,
      rows,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sending (the daily cron)
// ---------------------------------------------------------------------------

const html = (lines: string[], link: string, label: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join("")}<p><a href="${escapeHtml(link)}">${escapeHtml(label)}</a></p></div>`;

function vaEmail(v: VaReminder, overdue: boolean): Target | null {
  const to = v.email?.toLowerCase();
  if (!to) return null;
  const link = `${appUrl()}/va`;
  const subject = `${overdue ? "Reminder: " : ""}Your next quiz is waiting: ${v.next}`;
  const lines = [
    `Hi ${v.name},`,
    overdue
      ? `Your next quiz, ${v.next}, is still waiting. Please pick it up today; VFDA has been told it's overdue.`
      : `Your next quiz is waiting: ${v.next}. Open Today to keep going with your training.`,
  ];
  return {
    channel: "email",
    recipient: to,
    send: () => sendEmail(to, subject, html(lines, link, "Open Today"), `${lines.join("\n\n")}\n\nOpen Today: ${link}`, `${overdue ? "overdue" : "behind"}-${v.vaId}-${v.anchor?.key}-${to}`),
  };
}

const vfdaLine = (v: VaReminder) =>
  `${v.name} (${v.officeName}): ${v.anchor?.reason ?? "behind"}. Next: ${v.next}. Last activity ${v.activity.lastActivity} (${v.activity.daysSince} day${v.activity.daysSince === 1 ? "" : "s"} ago).`;

// First time behind: the VA, and VFDA by email and Slack.
async function remindBehind(db: Db, v: VaReminder) {
  const link = `${appUrl()}/admin/vas#va-${v.vaId}`;
  const subject = `VA behind: ${v.name} – ${v.officeName}`;
  const line = vfdaLine(v);
  const va = vaEmail(v, false);
  return deliver(db, { va_id: v.vaId, event: behindEvent(v.anchor!.key) }, [
    ...(va ? [va] : []),
    ...[...new Set(vfdaEmails().map((e) => e.toLowerCase()))].map(
      (to): Target => ({
        channel: "email",
        recipient: to,
        send: () => sendEmail(to, subject, html([line], link, "VA progress"), `${line}\n\nVA progress: ${link}`, `behind-${v.vaId}-${v.anchor!.key}-${to}`),
      }),
    ),
    { channel: "slack", recipient: SLACK_RECIPIENT, send: () => postSlack({ text: `*${slackEscape(subject)}*\n${slackEscape(line)}\n<${link}|VA progress>` }) },
  ]);
}

// Overdue: one alert to VFDA listing every overdue VA, when any VA newly
// became overdue. Each VA gets a row per channel, so each is in one alert.
async function alertOverdue(db: Db, overdue: VaReminder[]) {
  const link = `${appUrl()}/admin/vas`;
  const subject = `Overdue VAs: ${overdue.length}`;
  const lines = overdue.map((v) => `${vfdaLine(v)} Reminded first on ${v.remindedOn}.`);
  const targets: { channel: "email" | "slack"; recipient: string; send: () => Promise<void> }[] = [
    ...[...new Set(vfdaEmails().map((e) => e.toLowerCase()))].map((to) => ({
      channel: "email" as const,
      recipient: to,
      send: () =>
        sendEmail(
          to,
          `ALERT: ${subject}`,
          html(["These VAs are still behind 2 business days after their first reminder:", ...lines], link, "VA progress"),
          `These VAs are still behind 2 business days after their first reminder:\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\nVA progress: ${link}`,
          `overdue-${new Date().toISOString().slice(0, 10)}-${overdue.map((v) => v.vaId).join(",")}-${to}`,
        ),
    })),
    {
      channel: "slack" as const,
      recipient: SLACK_RECIPIENT,
      send: () => postSlack({ text: [`:rotating_light: *${slackEscape(subject)}*`, ...lines.map((l) => `• ${slackEscape(l)}`), `<${link}|VA progress>`].join("\n") }),
    },
  ];
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    // The VAs this channel hasn't been told about yet.
    const fresh = overdue.filter((v) => !v.rows.some((r) => r.event === overdueEvent(v.anchor!.key) && r.channel === t.channel && r.recipient === t.recipient && r.status === "sent"));
    if (!fresh.length) continue;
    const rows = fresh.map((v) => ({ va_id: v.vaId, event: overdueEvent(v.anchor!.key), channel: t.channel, recipient: t.recipient }));
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
      console.error("Overdue alert not sent", t.channel, error);
      failed++;
    }
  }
  return { sent, failed };
}

export async function runReminders(now = new Date()) {
  const db = createAdminClient();
  const today = todayIn(TIME_ZONE, now);
  // Business days only.
  if (!isBusinessDay(today)) return { today, behind: 0, overdue: 0, sent: 0, failed: 0, skipped: "weekend" };
  const board = await loadReminderBoard(db, now);
  let sent = 0;
  let failed = 0;
  const add = (r: { sent: number; failed: number }) => {
    sent += r.sent;
    failed += r.failed;
  };
  const behind = board.filter((v) => v.state === "behind" && !v.remindedOn);
  for (const v of behind) add(await remindBehind(db, v));
  const overdue = board.filter((v) => v.state === "overdue");
  for (const v of overdue) {
    const va = vaEmail(v, true);
    if (va) add(await deliver(db, { va_id: v.vaId, event: overdueEvent(v.anchor!.key) }, [va]));
  }
  if (overdue.length) add(await alertOverdue(db, overdue));
  return { today, behind: behind.length, overdue: overdue.length, sent, failed };
}

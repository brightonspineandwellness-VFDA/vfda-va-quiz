// The daily release schedule, as pure functions (no database).
//
// From the VA's start date, their scheduled quiz days (the training path:
// only their roles, only the days the office has) are released in order, one
// per weekday at 8:00 am in the OFFICE's time zone (offices.time_zone,
// default US Eastern). A start date on a weekend starts the next Monday.
//
// Nothing stores a release: it's worked out from the start date whenever it's
// needed, so a quiz opens at 8 am without any job running. The daily cron
// (/api/cron/recheck, src/lib/schedule-board.ts) only sends the emails.
//
// VFDA can change it from VA progress (profiles.release_schedule):
// - Pause: no release slot between the pause and the resume, so every day
//   not released yet moves forward by the weekdays paused.
// - Release next day now: that day is released at once and takes no slot,
//   so the days after it move one weekday earlier.
//
// A quiz is Late when it isn't submitted by 11:59 pm (office time) on its
// release day.

import { addDays, localParts, weekdayOf, zoneLabel } from "@/lib/week";

export const RELEASE_HOUR = 8;

export type Pause = { paused_at: string; resumed_at: string | null };
// profiles.release_schedule
export type ScheduleSettings = { pauses: Pause[]; early: Record<string, string> };

export function scheduleSettings(raw: unknown): ScheduleSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pauses = Array.isArray(r.pauses)
    ? (r.pauses as Pause[]).filter((p) => p && typeof p.paused_at === "string" && !Number.isNaN(Date.parse(p.paused_at)))
    : [];
  const early: Record<string, string> = {};
  if (r.early && typeof r.early === "object") {
    for (const [code, at] of Object.entries(r.early as Record<string, unknown>)) {
      if (typeof at === "string" && !Number.isNaN(Date.parse(at))) early[code] = at;
    }
  }
  return {
    pauses: pauses.map((p) => ({ paused_at: p.paused_at, resumed_at: typeof p.resumed_at === "string" ? p.resumed_at : null })),
    early,
  };
}

export const isPaused = (s: ScheduleSettings) => s.pauses.some((p) => !p.resumed_at);

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

// The instant it is `hour`:00 on `date` (YYYY-MM-DD) in `timeZone`.
export function zonedInstant(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hour);
  let guess = wanted;
  // Two passes settle daylight saving changes.
  for (let i = 0; i < 2; i++) {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += wanted - shown;
  }
  return new Date(guess);
}

// "Eastern", "Pacific", "Philippines"
export const shortZone = (tz: string | null | undefined) => zoneLabel(tz).replace(/^US /, "");

// "8:00 am Eastern (office time)"
export const releaseTimeText = (tz: string | null | undefined) => `${RELEASE_HOUR}:00 am ${shortZone(tz)} (office time)`;

const isWeekday = (iso: string) => ![0, 6].includes(weekdayOf(iso));
export const firstWeekday = (iso: string) => {
  let d = iso;
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
};
export const nextWeekday = (iso: string) => firstWeekday(addDays(iso, 1));

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export type ReleaseStatus = "upcoming" | "open" | "done" | "late";

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  upcoming: "Upcoming",
  open: "Open",
  done: "Done",
  late: "Late",
};

export type DaySchedule = {
  code: string;
  // The office date it is released (null: not scheduled yet: no start date, or paused).
  releaseDate: string | null;
  releaseAt: string | null; // ISO
  // Released by "Release next day now".
  early: boolean;
  released: boolean;
  done: boolean;
  late: boolean;
  status: ReleaseStatus;
};

export type ScheduleInput = {
  // The training path's day codes, in order.
  codes: string[];
  startDate: string | null;
  timeZone: string;
  settings: ScheduleSettings;
  // Days submitted.
  done: Set<string>;
  // Days already opened (an open quiz from before the schedule, or a day VFDA opened): released.
  opened: Set<string>;
  // Days released no earlier than this office date (practice days added later).
  notBefore?: Record<string, string>;
  now: Date;
};

export function buildSchedule(input: ScheduleInput): DaySchedule[] {
  const { timeZone, settings, now } = input;
  const instant = (date: string) => zonedInstant(date, RELEASE_HOUR, timeZone);
  // A slot is skipped when its 8 am falls inside a pause.
  const pausedAt = (t: Date) =>
    settings.pauses.find((p) => Date.parse(p.paused_at) <= t.getTime() && (!p.resumed_at || t.getTime() < Date.parse(p.resumed_at)));
  let slot: string | null = input.startDate ? firstWeekday(input.startDate.slice(0, 10)) : null;

  return input.codes.map((code) => {
    let releaseDate: string | null = null;
    let releaseAt: Date | null = null;
    const earlyAt = settings.early[code];
    if (earlyAt) {
      releaseAt = new Date(earlyAt);
      releaseDate = localParts(timeZone, releaseAt).date;
    } else if (slot) {
      // Skip the slots inside a pause; a pause still running stops the schedule.
      for (;;) {
        const p = pausedAt(instant(slot));
        if (!p) break;
        if (!p.resumed_at) {
          slot = null;
          break;
        }
        slot = nextWeekday(slot);
      }
      const floor = input.notBefore?.[code];
      if (slot && floor && slot < floor) {
        slot = firstWeekday(floor);
        // A pause still applies after the move.
        while (slot) {
          const p = pausedAt(instant(slot));
          if (!p) break;
          slot = p.resumed_at ? nextWeekday(slot) : null;
        }
      }
      if (slot) {
        releaseDate = slot;
        releaseAt = instant(slot);
        slot = nextWeekday(slot);
      }
    }
    const done = input.done.has(code);
    const released = done || input.opened.has(code) || (!!releaseAt && now.getTime() >= releaseAt.getTime());
    // Late: not submitted by 11:59 pm office time on the release day.
    const late = !done && released && !!releaseDate && now.getTime() >= zonedInstant(addDays(releaseDate, 1), 0, timeZone).getTime();
    const status: ReleaseStatus = done ? "done" : late ? "late" : released ? "open" : "upcoming";
    return { code, releaseDate, releaseAt: releaseAt?.toISOString() ?? null, early: !!earlyAt, released, done, late, status };
  });
}

// The next day not released yet (for "Release next day now").
export const nextUnreleased = (schedule: DaySchedule[]) => schedule.find((d) => !d.released) ?? null;

// "Day 6 of 10 released · 2 late"
export function scheduleSummary(schedule: DaySchedule[]) {
  const released = schedule.filter((d) => d.released).length;
  const late = schedule.filter((d) => d.late).length;
  return { released, total: schedule.length, late, text: `Day ${released} of ${schedule.length} released · ${late} late` };
}

// "Mon, Nov 30"
export const releaseDateText = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// The office's date now.
export const officeToday = (timeZone: string, now: Date) => localParts(timeZone, now).date;

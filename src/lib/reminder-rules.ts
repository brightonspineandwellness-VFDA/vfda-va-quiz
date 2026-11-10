// When a VA is behind, as pure functions (src/lib/reminders.ts loads the
// data and sends the reminders from the daily cron).
//
// Behind: a quiz opened but not submitted for 24 hours, or no cards marked
// done and no quiz submitted for 2 business days since the last activity (or
// since the start date). The first time: the VA and VFDA are told. Still
// behind 2 business days after that: overdue, and both are told again.
// A stretch of being behind is one "episode", named by what started it, so
// each reminder goes out once per episode.

export const OPEN_QUIZ_HOURS = 24;
export const IDLE_BUSINESS_DAYS = 2;
export const OVERDUE_BUSINESS_DAYS = 2;

const parseDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const isWeekend = (iso: string) => [0, 6].includes(parseDate(iso).getUTCDay());

// Weekdays after `from` up to and including `to` (both YYYY-MM-DD): Friday to Monday is 1.
export function businessDaysBetween(from: string, to: string): number {
  const d = parseDate(from);
  const end = parseDate(to);
  let n = 0;
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
}

export const calendarDaysBetween = (from: string, to: string) => Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);

export const isBusinessDay = (iso: string) => !isWeekend(iso);

export type Anchor = { key: string; reason: string };

export type ActivityInput = {
  now: Date;
  today: string; // YYYY-MM-DD where training runs
  dateOf: (timestamp: string) => string; // a timestamp's date where training runs
  startDate: string | null;
  createdAt: string;
  // Timestamps: each day's cards marked done, each quiz submitted.
  cardsDone: string[];
  submitted: string[];
  // Quizzes opened and not submitted.
  open: { id: string; startedAt: string; label: string }[];
};

export type Activity = {
  // The last time cards were marked done or a quiz submitted (else the start date), and days since.
  lastActivity: string;
  daysSince: number;
  // What makes the VA behind right now (empty: not behind).
  anchors: Anchor[];
};

export function activity(input: ActivityInput): Activity {
  const done = [...input.cardsDone, ...input.submitted].map(input.dateOf).sort();
  const last = done.at(-1) ?? input.startDate ?? input.dateOf(input.createdAt);
  const anchors: Anchor[] = [];
  // Not started yet: nothing is late.
  if (last <= input.today && businessDaysBetween(last, input.today) >= IDLE_BUSINESS_DAYS) {
    anchors.push({
      key: `idle:${last}`,
      reason: done.length ? `no cards marked done or quiz submitted since ${last}` : `nothing done since the start date (${last})`,
    });
  }
  for (const o of input.open) {
    if (input.now.getTime() - new Date(o.startedAt).getTime() >= OPEN_QUIZ_HOURS * 3600 * 1000) {
      anchors.push({ key: `open:${o.id}`, reason: `${o.label} quiz opened ${input.dateOf(o.startedAt)} and not submitted` });
    }
  }
  return { lastActivity: last, daysSince: Math.max(0, calendarDaysBetween(last, input.today)), anchors };
}

export type ReminderState = "ok" | "behind" | "overdue";

// The episode: one already reminded about, if it still holds, else the first.
// `firstReminded`: each episode's first reminder date (YYYY-MM-DD).
export function episode(anchors: Anchor[], firstReminded: Map<string, string>, today: string) {
  if (!anchors.length) return { state: "ok" as ReminderState, anchor: null, remindedOn: null };
  const anchor = anchors.find((a) => firstReminded.has(a.key)) ?? anchors[0];
  const remindedOn = firstReminded.get(anchor.key) ?? null;
  const overdue = !!remindedOn && businessDaysBetween(remindedOn, today) >= OVERDUE_BUSINESS_DAYS;
  return { state: (overdue ? "overdue" : "behind") as ReminderState, anchor, remindedOn };
}

export const behindEvent = (anchor: string) => `behind:${anchor}`;
export const overdueEvent = (anchor: string) => `overdue:${anchor}`;
export const anchorOf = (event: string) => event.replace(/^(behind|overdue):/, "");

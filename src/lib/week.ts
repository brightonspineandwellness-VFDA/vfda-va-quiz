// Sunday-night sends (the weekly summary and the training program), as pure
// functions. Each office has a time zone (offices.time_zone, default US
// Eastern); it decides the office's dates: which Sunday it is, the week
// before it, and the Sunday dates on the plan.
//
// The Vercel cron runs once a week, "7 1 * * 1" (UTC) = Sunday 8:07 pm
// Eastern standard time. An office is due on Sunday from 8 pm its own time
// until Monday noon. Offices west of Eastern are still before 8 pm when that
// cron runs, so the weekly cron also counts as their Sunday night when it's
// Sunday evening there (after 3 pm). A cron run every hour on Sundays and
// Mondays would send each office at 8 pm its own time; nothing is ever sent
// twice either way (notifications).

export const DEFAULT_TIME_ZONE = "America/New_York";
export const SEND_HOUR = 20;

export const TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "US Eastern" },
  { value: "America/Chicago", label: "US Central" },
  { value: "America/Denver", label: "US Mountain" },
  { value: "America/Phoenix", label: "US Arizona" },
  { value: "America/Los_Angeles", label: "US Pacific" },
  { value: "America/Anchorage", label: "US Alaska" },
  { value: "Pacific/Honolulu", label: "US Hawaii" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
  { value: "Asia/Manila", label: "Philippines" },
];

export const zoneOf = (tz: string | null | undefined) => (tz && TIME_ZONES.some((z) => z.value === tz) ? tz : DEFAULT_TIME_ZONE);
export const zoneLabel = (tz: string | null | undefined) => TIME_ZONES.find((z) => z.value === zoneOf(tz))?.label ?? "US Eastern";

// The office's local date (YYYY-MM-DD), weekday (0 = Sunday) and hour.
export function localParts(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday, hour: Number(get("hour")) };
}

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekdayOf = (iso: string) => parse(iso).getUTCDay();

// The first Sunday strictly after a date.
export const sundayAfter = (iso: string) => addDays(iso, 7 - weekdayOf(iso));

// "Sun, Nov 22"
export const sundayText = (iso: string) => parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// The Sunday whose night it is in the office now, or null when it isn't
// Sunday night there. `weeklyCron`: this run is the once-a-week cron.
export function dueSunday(timeZone: string, now: Date, weeklyCron = false): string | null {
  const { date, weekday, hour } = localParts(timeZone, now);
  if (weekday === 0 && (hour >= SEND_HOUR || (weeklyCron && hour >= 15))) return date;
  if (weekday === 1 && hour < 12) return addDays(date, -1);
  return null;
}

// The Sunday a manual or test send is for: today if it's Sunday there, else the last Sunday.
export function lastSunday(timeZone: string, now: Date): string {
  const { date, weekday } = localParts(timeZone, now);
  return addDays(date, -weekday);
}

// The week a Sunday summary covers: Monday to that Sunday.
export const weekOf = (sunday: string) => ({ from: addDays(sunday, -6), to: sunday });

// A timestamp's local date in the office.
export const localDate = (timeZone: string, ts: string) => localParts(timeZone, new Date(ts)).date;

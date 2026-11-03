// The VA's training path, written as pure functions so it can be tested without
// a database: which days the VA gets and in what order, when the next one
// opens, the next item to show, the day's result label and trend, and the
// honesty checks (Keeping it honest). Quizzes measure understanding; they never
// block. The server (src/lib/va-training.ts) loads the rows and acts on what
// these return.

import { applies, normalizeRemoteAccess, type Profile } from "@/lib/interview";

export type AnswerFormat = "steps_say_doc" | "say_do_book";
// "done": the day's one attempt was submitted. Older rows may still say
// passed / in_review / submitted / retake; every one of those counts as done.
export type UnlockStatus = "locked" | "open" | "done";
export type Version = "A" | "B";
export type ResultLabel = "strong" | "needs_coaching" | "at_risk";

export const RESULT_LABELS: Record<ResultLabel, string> = {
  strong: "Strong",
  needs_coaching: "Needs coaching",
  at_risk: "At risk",
};

// Older attempts may carry pass / review / retake until the SQL relabels them.
export const resultLabel = (r: string | null | undefined) => (r && r in RESULT_LABELS ? RESULT_LABELS[r as ResultLabel] : "–");

export const unlockStatus = (s: string | null | undefined): UnlockStatus =>
  !s || s === "locked" ? "locked" : s === "open" ? "open" : "done";

export type DayRow = {
  code: string;
  week: number;
  day: number;
  title: string;
  cards: string[];
  condition: string;
  max_points: number | null;
  pass_points: number | null;
  review_min_points: number | null;
  answer_format: AnswerFormat;
  proof_of_work: string[];
};

export type UnlockRow = {
  schedule_day: string;
  version: Version;
  status: string;
  cards_done_at: string | null;
  unlocked_at: string | null;
};

export type ProofRow = {
  id: string;
  schedule_day: string;
  file_path: string | null;
  file_name: string | null;
  link_url: string | null;
  status: "pending" | "accepted" | "redo";
  review_note: string | null;
  created_at: string;
};

export type OfficeFlags = {
  bills_insurance: boolean | null;
  billing_type: string | null;
  has_reexam_card: boolean | null;
  has_gray_cards: boolean | null;
  remote_access_tool: string | null;
};

const yesNo = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");

// The profile switches, read from the office row (the database keeps it in sync).
export function officeProfile(o: OfficeFlags): Profile {
  return {
    BILLS_INSURANCE: yesNo(o.bills_insurance),
    BILLING_TYPE: (o.billing_type ?? "").toLowerCase(),
    HAS_REEXAM_CARD: yesNo(o.has_reexam_card),
    HAS_GRAY_CARDS: yesNo(o.has_gray_cards),
    REMOTE_ACCESS_TOOL: normalizeRemoteAccess(o.remote_access_tool ?? ""),
  };
}

// The VA's days, in settings.sequence order: every day whose condition holds
// for the office, plus any day the office has scenarios for anyway (a skipped
// day's extra phone scenarios).
export function trainingPath(input: {
  sequence: string[];
  days: DayRow[];
  conditions: Record<string, string>;
  profile: Profile;
  officeScenarioDays: Set<string>;
}): DayRow[] {
  const byCode = new Map(input.days.map((d) => [d.code, d]));
  return input.sequence
    .map((code) => byCode.get(code))
    .filter((d): d is DayRow => !!d)
    .filter((d) => input.officeScenarioDays.has(d.code) || applies(d.condition, input.conditions, input.profile));
}

// ---------------------------------------------------------------------------
// Dates. Training days are weekdays (a new VA's suggested start date).
// ---------------------------------------------------------------------------

const parseDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const formatDate = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

export function addTrainingDays(iso: string, n: number): string {
  const d = parseDate(iso);
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < n; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    while (isWeekend(d)) d.setUTCDate(d.getUTCDate() + 1);
  }
  return formatDate(d);
}

// Today's date (YYYY-MM-DD) where training runs.
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function showDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Today: the open day, or what it is waiting for.
// ---------------------------------------------------------------------------

export type DayView = {
  index: number; // 1-based training day number
  day: DayRow;
  unlock: UnlockRow | null;
  status: UnlockStatus;
  version: Version;
};

// "cards": waiting for the VA's "Mark today's cards done".
// "preparing": cards done, but VFDA hasn't approved the day's scenarios for the office yet.
export type Today =
  | { kind: "no_days" }
  | { kind: "finished"; days: DayView[] }
  | { kind: "open"; days: DayView[]; current: DayView }
  | { kind: "cards"; days: DayView[]; current: DayView }
  | { kind: "preparing"; days: DayView[]; current: DayView };

export const dayName = (v: Pick<DayView, "index" | "day">) => `Day ${v.index} (${v.day.code}): ${v.day.title}`;

// Proof for a day: shown and reviewed, never blocking.
export function proofState(day: DayRow, proofs: ProofRow[]): "none_needed" | "accepted" | "pending" | "redo" | "missing" {
  if (day.proof_of_work.length === 0) return "none_needed";
  const mine = proofs.filter((p) => p.schedule_day === day.code);
  if (mine.some((p) => p.status === "accepted")) return "accepted";
  if (mine.some((p) => p.status === "pending")) return "pending";
  return mine.length ? "redo" : "missing";
}

// The next day opens once the day before it was submitted (any score), the VA
// marked its cards done, and VFDA approved its scenarios for the office.
export function buildToday(input: {
  path: DayRow[];
  unlocks: UnlockRow[];
  // Every day VFDA has approved for the office.
  approved: Set<string>;
}): Today {
  if (input.path.length === 0) return { kind: "no_days" };
  const byDay = new Map(input.unlocks.map((u) => [u.schedule_day, u]));
  const days: DayView[] = input.path.map((day, i) => {
    const unlock = byDay.get(day.code) ?? null;
    return { index: i + 1, day, unlock, status: unlockStatus(unlock?.status), version: "A" };
  });
  // Every day before this one is done, so the previous quiz was submitted.
  const current = days.find((d) => d.status !== "done");
  if (!current) return { kind: "finished", days };
  if (current.status === "open") return { kind: "open", days, current };
  if (!current.unlock?.cards_done_at) return { kind: "cards", days, current };
  return input.approved.has(current.day.code) ? { kind: "open", days, current } : { kind: "preparing", days, current };
}

// ---------------------------------------------------------------------------
// The scenario screen.
// ---------------------------------------------------------------------------

export const ANSWER_BOXES: Record<AnswerFormat, { key: string; label: string; hint: string }[]> = {
  steps_say_doc: [
    { key: "steps", label: "Steps", hint: "What you do, in order" },
    { key: "say", label: "Say", hint: "What you say to the patient" },
    { key: "document", label: "Document / Escalate", hint: "What you write down, and who you tell" },
  ],
  say_do_book: [
    { key: "say", label: "Say", hint: "What you say to the patient" },
    { key: "do", label: "Do", hint: "What you do in the EHR, texting or phone system (describe it)" },
    { key: "book", label: "Book", hint: "What you book, and when" },
  ],
};

// What the VA's browser gets for one item. Display only: no answer keys.
export type Feedback = { reason: string; missedSteps: string[]; repeatNext: boolean; ungraded: boolean };

export type ServedItem = {
  scenarioId: string; // the day's scenario (a repeat is answered under its parent)
  phase: "first" | "repeat";
  number: number;
  total: number;
  dayCode: string;
  dayTitle: string;
  workflow: string;
  partTitle: string;
  type: "mc" | "situational";
  format: AnswerFormat;
  stem: string;
  options: string[] | null; // already shuffled for this VA
  priorFeedback: Feedback | null; // shown above a repeat
  drillId: string | null; // a workflow recheck, not a training day
};

export type ItemProgress = {
  office_scenario_id: string;
  first_answer: unknown;
  first_score: number | null;
  repeat_scenario_id: string | null;
  repeat_answer: unknown;
};

// The item to show now: the first scenario not answered yet, or the repeat of
// one just missed. Items already answered are never shown again.
export function nextItem<S extends { id: string; type: "mc" | "situational" }>(
  scenarios: S[],
  items: ItemProgress[],
): { scenario: S; phase: "first" | "repeat"; item: ItemProgress | null } | null {
  const byId = new Map(items.map((i) => [i.office_scenario_id, i]));
  for (const scenario of scenarios) {
    const item = byId.get(scenario.id) ?? null;
    if (!item || item.first_answer == null) return { scenario, phase: "first", item };
    if (item.repeat_scenario_id && item.repeat_answer == null) return { scenario, phase: "repeat", item };
  }
  return null;
}

// Multiple choice options in a fixed per-VA order: order[k] is the original
// index of the option shown k-th. Same VA + same scenario = same order.
export function shuffleOrder(seed: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const random = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export const optionLetter = (index: number) => String.fromCharCode(65 + index);

// ---------------------------------------------------------------------------
// Day result: a label that never blocks (settings.grading).
// ---------------------------------------------------------------------------

export type CertificationRules = {
  mcPoints: number;
  // A grade below this confidence is flagged for VFDA to look at.
  lowConfidenceBelow: number;
  // First-try share for Strong, and below which a day is At risk.
  strongPercent: number;
  atRiskBelowPercent: number;
};

export function certificationRules(grading: unknown): CertificationRules {
  const g = (grading ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    mcPoints: num(g.mc_points, 1),
    lowConfidenceBelow: num(g.low_confidence_below, 0.7),
    strongPercent: num(g.strong_percent, 80),
    atRiskBelowPercent: num(g.at_risk_below_percent, 60),
  };
}

export type GradedItem = {
  type: "mc" | "situational";
  points: number;
  first_score: number | null;
  repeat_score: number | null;
  critical_error: boolean;
  ai_confidence: number | null;
};

// A VFDA score override (attempt_items.vfda_override) replaces the grader's
// scores and critical flag; it changes only the label.
export type ScoreOverride = {
  first_score: number | null;
  repeat_score: number | null;
  critical_error: boolean;
  note: string;
  by: string;
  at: string;
};

export function withOverride<T extends Omit<GradedItem, "type" | "points">>(item: T, override: unknown): T {
  const o = override as ScoreOverride | null;
  if (!o || typeof o !== "object") return item;
  return {
    ...item,
    first_score: o.first_score ?? item.first_score,
    repeat_score: o.repeat_score ?? item.repeat_score,
    critical_error: !!o.critical_error,
    ai_confidence: 1,
  };
}

// Strong: first try >= 80% and no critical error.
// Needs coaching: first try 60-79%, or a repeat still below 2/2.
// At risk: first try below 60%, or any critical error.
// An answer the grader couldn't score counts toward neither points nor max
// until VFDA scores it.
export function dayResult(items: GradedItem[], rules: CertificationRules) {
  const graded = items.filter((i) => i.first_score !== null);
  const max = graded.reduce((n, i) => n + i.points, 0);
  const points = graded.reduce((n, i) => n + (i.first_score ?? 0), 0);
  const percent = max > 0 ? Math.round((points * 100) / max) : 0;
  const criticalErrors = items.filter((i) => i.critical_error).length;
  const situational = items.filter((i) => i.type === "situational");
  const repeatsBelow = situational.filter((i) => i.repeat_score !== null && i.repeat_score < 2).length;
  const lowConfidence = situational.filter((i) => i.ai_confidence !== null && i.ai_confidence < rules.lowConfidenceBelow).length;
  const ungraded = situational.filter((i) => i.first_score === null).length;

  // Exact shares (79.6% is not 80%); `percent` is rounded for display only.
  const below = (p: number) => max === 0 || points * 100 < p * max;
  let result: ResultLabel;
  if (criticalErrors > 0 || below(rules.atRiskBelowPercent)) result = "at_risk";
  else if (below(rules.strongPercent) || repeatsBelow > 0) result = "needs_coaching";
  else result = "strong";
  return { result, points, max, percent, criticalErrors, repeatsBelow, lowConfidence, ungraded };
}

// ---------------------------------------------------------------------------
// Trend across days: the latest days' first-try average against the days before.
// ---------------------------------------------------------------------------

export type Trend = "improving" | "flat" | "declining";
// Points of difference that count as a change.
const TREND_STEP = 5;

// `percents`: first-try % per day, oldest first. Null with fewer than 2 days.
export function trend(percents: number[]): Trend | null {
  if (percents.length < 2) return null;
  const recentCount = Math.min(3, Math.ceil(percents.length / 2));
  const recent = percents.slice(-recentCount);
  const earlier = percents.slice(0, -recentCount).slice(-3);
  const avg = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
  const diff = avg(recent) - avg(earlier);
  return diff >= TREND_STEP ? "improving" : diff <= -TREND_STEP ? "declining" : "flat";
}

export const percentOf = (points: number | string | null, max: number | null) =>
  max ? Math.round((Number(points ?? 0) * 100) / max) : 0;

// ---------------------------------------------------------------------------
// Keeping it honest: flag finishes much faster than normal.
// ---------------------------------------------------------------------------

// Seconds an item normally takes before other VAs' times are known.
const DEFAULT_SECONDS = { mc: 20, situational: 120 } as const;
const MIN_SAMPLES = 5;
// "Much faster" = under a third of normal.
export const FAST_RATIO = 1 / 3;

export function normalSeconds(type: "mc" | "situational", samples: number[]): number {
  if (samples.length < MIN_SAMPLES) return DEFAULT_SECONDS[type];
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const isFast = (seconds: number, normal: number) => seconds < normal * FAST_RATIO;

export const secondsBetween = (from: string | null, to: Date) =>
  from ? Math.max(0, Math.round((to.getTime() - Date.parse(from)) / 1000)) : null;

export type PasteEvent = { box: string; chars: number; at: string };

// Pastes are logged, never blocked. Keep only well-formed entries.
export function cleanPasteLog(raw: unknown, boxes: string[]): PasteEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is PasteEvent =>
        !!p &&
        typeof p === "object" &&
        boxes.includes((p as PasteEvent).box) &&
        Number.isInteger((p as PasteEvent).chars) &&
        typeof (p as PasteEvent).at === "string" &&
        !Number.isNaN(Date.parse((p as PasteEvent).at)),
    )
    .slice(0, 50)
    .map((p) => ({ box: p.box, chars: Math.max(0, Math.min(p.chars, 100000)), at: p.at.slice(0, 40) }));
}

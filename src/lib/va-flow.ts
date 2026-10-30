// The VA's training path, written as pure functions so it can be tested without
// a database: which days the VA gets and in what order, what is blocking the
// next one (SPEC section 6, Unlocking), the next item to show, the day result
// (Scoring) and the honesty checks (Keeping it honest). The server
// (src/lib/va-training.ts) loads the rows and acts on what these return.

import { applies, normalizeRemoteAccess, type Profile } from "@/lib/interview";

export type AnswerFormat = "steps_say_doc" | "say_do_book";
export type UnlockStatus = "locked" | "open" | "submitted" | "passed" | "in_review" | "retake";
export type Version = "A" | "B";
export type DayResult = "pass" | "review" | "retake";

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
  status: UnlockStatus;
  cards_done_at: string | null;
  unlocked_at: string | null;
  opens_on: string | null;
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
// Dates. Training days are weekdays, counted from va_start_date.
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
// Today: the one open day, or exactly what is blocking it.
// ---------------------------------------------------------------------------

export type CheckKey = "previous" | "cards" | "date" | "approved" | "proof";
export type Check = { key: CheckKey; ok: boolean; text: string };

export type DayView = {
  index: number; // 1-based training day number
  day: DayRow;
  unlock: UnlockRow | null;
  status: UnlockStatus;
  version: Version;
};

export type Today =
  | { kind: "no_days" }
  | { kind: "finished"; days: DayView[] }
  | { kind: "open"; days: DayView[]; current: DayView }
  | { kind: "waiting"; days: DayView[]; current: DayView; message: string }
  | { kind: "blocked"; days: DayView[]; current: DayView; checks: Check[] };

export const dayName = (v: Pick<DayView, "index" | "day">) => `Day ${v.index} (${v.day.code}): ${v.day.title}`;

// Proof for a day is done when VFDA accepted an upload, or the day asks for none.
export function proofState(day: DayRow, proofs: ProofRow[]): "none_needed" | "accepted" | "pending" | "redo" | "missing" {
  if (day.proof_of_work.length === 0) return "none_needed";
  const mine = proofs.filter((p) => p.schedule_day === day.code);
  if (mine.some((p) => p.status === "accepted")) return "accepted";
  if (mine.some((p) => p.status === "pending")) return "pending";
  return mine.length ? "redo" : "missing";
}

function waitingText(v: DayView) {
  if (v.status === "submitted") return `${dayName(v)}: your answers are being graded`;
  return v.version === "B"
    ? `${dayName(v)}: VFDA will set up a call with you about your retake`
    : `${dayName(v)}: VFDA is reviewing your results`;
}

export function buildToday(input: {
  path: DayRow[];
  unlocks: UnlockRow[];
  proofs: ProofRow[];
  // "W1D1:A" for every day and version VFDA has approved for the office.
  approved: Set<string>;
  startDate: string | null;
  today: string;
}): Today {
  if (input.path.length === 0) return { kind: "no_days" };
  const byDay = new Map(input.unlocks.map((u) => [u.schedule_day, u]));
  const days: DayView[] = input.path.map((day, i) => {
    const unlock = byDay.get(day.code) ?? null;
    return { index: i + 1, day, unlock, status: unlock?.status ?? "locked", version: unlock?.version ?? "A" };
  });
  const first = days.findIndex((d) => d.status !== "passed");
  if (first === -1) return { kind: "finished", days };
  if (days[first].status === "open") return { kind: "open", days, current: days[first] };

  // A finished day waiting on grading or VFDA blocks the day after it.
  const waiting = days[first].status === "submitted" || days[first].status === "in_review";
  const i = waiting ? first + 1 : first;
  const previous = i > 0 ? days[i - 1] : null;
  if (i >= days.length) {
    return { kind: "waiting", days, current: days[first], message: waitingText(days[first]) };
  }
  const current = days[i];

  const checks: Check[] = [];
  // 1. Previous day passed (or approved from review).
  if (previous) {
    checks.push(
      waiting
        ? { key: "previous", ok: false, text: waitingText(previous) }
        : { key: "previous", ok: true, text: `${dayName(previous)} passed` },
    );
  }
  // 2. Today's cards marked done.
  checks.push(
    current.unlock?.cards_done_at
      ? { key: "cards", ok: true, text: "Today's cards marked done" }
      : { key: "cards", ok: false, text: `Read today's cards (${current.day.cards.join(", ")}) and mark them done` },
  );
  // 3. That training day reached (a retake's version B waits for the next day too).
  if (!input.startDate) {
    checks.push({ key: "date", ok: false, text: "VFDA hasn't set your training start date yet" });
  } else {
    let opens = addTrainingDays(input.startDate, i);
    const retakeOn = current.status === "retake" ? current.unlock?.opens_on : null;
    if (retakeOn && retakeOn > opens) opens = retakeOn;
    const label = current.status === "retake" ? `Your retake (version B) opens` : `Training day ${current.index} opens`;
    checks.push(
      input.today >= opens
        ? { key: "date", ok: true, text: `${label} today or earlier (${showDate(opens)})` }
        : { key: "date", ok: false, text: `${label} on ${showDate(opens)}` },
    );
  }
  // 4. VFDA approved this day's scenarios (in this version) for the office.
  checks.push(
    input.approved.has(`${current.day.code}:${current.version}`)
      ? { key: "approved", ok: true, text: "VFDA approved today's scenarios for your office" }
      : {
          key: "approved",
          ok: false,
          text: `VFDA hasn't approved ${current.day.code}${current.version === "B" ? " version B" : ""} for your office yet`,
        },
  );
  // 5. Previous day's proof of work accepted.
  if (previous) {
    const proof = proofState(previous.day, input.proofs);
    const code = previous.day.code;
    const proofCheck: Record<typeof proof, Check | null> = {
      none_needed: null,
      accepted: { key: "proof", ok: true, text: `Proof of work for ${code} accepted` },
      pending: { key: "proof", ok: false, text: `VFDA hasn't checked your proof of work for ${code} yet` },
      redo: { key: "proof", ok: false, text: `VFDA asked you to redo your proof of work for ${code}` },
      missing: { key: "proof", ok: false, text: `Upload your proof of work for ${code}` },
    };
    if (proofCheck[proof]) checks.push(proofCheck[proof]);
  }

  return checks.every((c) => c.ok) ? { kind: "open", days, current } : { kind: "blocked", days, current, checks };
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
// Day result (SPEC section 6, Scoring; settings.certification and .grading).
// ---------------------------------------------------------------------------

export type CertificationRules = {
  mcPoints: number;
  // A grade below this confidence sends the day to review.
  lowConfidenceBelow: number;
  // Used only when the day has no thresholds of its own (W2D5).
  passRatio: number;
  reviewRatio: number;
};

export function certificationRules(grading: unknown): CertificationRules {
  const g = (grading ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    mcPoints: num(g.mc_points, 1),
    lowConfidenceBelow: num(g.low_confidence_below, 0.7),
    passRatio: num(g.pass_ratio, 0.8),
    reviewRatio: num(g.review_ratio, 0.65),
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

export function dayResult(day: DayRow, items: GradedItem[], rules: CertificationRules) {
  const max = items.reduce((n, i) => n + i.points, 0);
  // The day's thresholds are set for its full master list; scale them if the
  // office's version of the day has a different total.
  const scale = (points: number | null, ratio: number) =>
    day.max_points && points !== null ? Math.ceil((points * max) / day.max_points) : Math.ceil(ratio * max);
  const passPoints = scale(day.pass_points, rules.passRatio);
  const reviewMin = scale(day.review_min_points, rules.reviewRatio);

  const points = items.reduce((n, i) => n + (i.first_score ?? 0), 0);
  const criticalErrors = items.filter((i) => i.critical_error).length;
  const situational = items.filter((i) => i.type === "situational");
  const uncorrected = situational.filter((i) => (i.first_score ?? 0) < 2 && i.repeat_score !== 2).length;
  const lowConfidence = situational.filter((i) => i.ai_confidence === null || i.ai_confidence < rules.lowConfidenceBelow).length;

  // A grade that never came back (the grader was down) isn't the VA's fault:
  // VFDA decides those days.
  const ungraded = situational.filter((i) => i.first_score === null).length;

  let result: DayResult;
  if (criticalErrors > 0) result = "retake";
  else if (ungraded > 0) result = "review";
  else if (points < reviewMin) result = "retake";
  else if (points >= passPoints && uncorrected === 0 && lowConfidence === 0) result = "pass";
  else result = "review";
  return { result, points, max, passPoints, reviewMin, criticalErrors, uncorrected, lowConfidence, ungraded };
}

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

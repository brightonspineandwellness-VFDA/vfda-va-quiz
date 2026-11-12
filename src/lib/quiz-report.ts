// The quiz report PDF of one finished attempt (a day, a retake or a drill),
// as pure functions: what goes in it, the mock coaching tips (AI_MODE=mock),
// and the check on Claude's tips. src/lib/quiz-reports.ts loads the data,
// asks Claude and stores the PDF; src/lib/quiz-report-pdf.ts draws it.

import { requiredSteps } from "@/lib/mock-grade";
import { trendSummary, type DayHistory, type RepeatStats } from "@/lib/report";
import { standardsUsed, vaTipTags, type ItemRuleSource, type TipTag } from "@/lib/rule-source";
import { resultLabel } from "@/lib/va-flow";

// The doctor's line when the card was fine and only the VA needs coaching.
export const CARD_IS_CLEAR = "Card is clear – VA coaching only";

export type NeedsWorkItem = {
  key: string; // the item's position, for matching Claude's tips
  code: string;
  workflow: string;
  workflowName: string;
  type: "mc" | "situational" | "describe";
  points: number;
  score: number | null; // null: not graded yet
  // The question as the VA saw it, and their exact words.
  scenario: string;
  answer: string;
  // From grading: why, and each step missed or wrong. Multiple choice: the right option.
  reason: string;
  missed: string[];
  critical: boolean;
  criticalQuote: string | null;
  // The question's topic, and why an answer is critical (the scenario's critical fail).
  partTitle: string;
  criticalFail: string | null;
  // What the card says about it (null: the card is silent), for the doctor's tip.
  sourceCard: string | null;
  sourceQuote: string | null;
  correct: string[];
  // Where the rule it was graded against came from (src/lib/rule-source.ts).
  ruleSource?: ItemRuleSource | null;
};

export type DoneWellItem = { workflow: string; workflowName: string; partTitle: string; correct: string[]; ruleSource?: ItemRuleSource | null };

export type Tips = {
  items: { key: string; coaching: string; card: string | null }[];
  strengths: { workflow: string; bullets: string[] }[];
};

export type TrendRow = {
  day: string;
  percent: number; // first try
  label: string;
  retakePercent: number | null;
  retakeLabel: string | null;
  current: boolean;
};

export type QuizTrend = {
  rows: TrendRow[];
  direction: "improving" | "steady" | "declining" | null; // null: the first day, no trend yet
  change: number | null; // percentage points since the first day
  repeats: { quiz: { right: number; total: number }; soFar: { right: number; total: number } };
};

export function quizTrend(history: DayHistory[], repeats: { quiz: RepeatStats; soFar: RepeatStats } | undefined): QuizTrend {
  const { direction, change } = trendSummary(history);
  return {
    rows: history.map((h) => ({
      day: h.day,
      percent: h.percent,
      label: resultLabel(h.label),
      retakePercent: h.retakePercent,
      retakeLabel: h.retakeLabel ? resultLabel(h.retakeLabel) : null,
      current: h.current,
    })),
    direction,
    change,
    repeats: repeats ?? { quiz: { right: 0, total: 0 }, soFar: { right: 0, total: 0 } },
  };
}

export type QuizReport = {
  vaName: string;
  officeName: string;
  doctors: string[]; // Primary first
  dayCode: string;
  topic: string;
  date: string; // ISO
  points: number;
  maxPoints: number;
  resultLabel: string;
  retake: boolean;
  timeSpent: number | null; // seconds
  trend: QuizTrend;
  needsWork: (NeedsWorkItem & { coaching: string; cardTip: string })[];
  strengths: { workflow: string; name: string; bullets: string[] }[];
  // The Alerts box under the header: every critical error, then the flags.
  alerts: { critical: CriticalAlert[]; flags: string[] };
  // "Coaching tips given to the VA" (va_reports); null before they're written.
  // tags: each tip's "VFDA standard" / "Card: ..." tag.
  vaTips: { alerts: string[]; tips: string[]; strengths: string[]; tags?: (TipTag | null)[] } | null;
  // The VFDA standard rules any item relied on (the notice under the Alerts box); empty: no notice.
  standards: string[];
};

export type CriticalAlert = { code: string; topic: string; quote: string; why: string; coaching: string };

export type FlagInput = {
  retake: boolean;
  fastFinish: boolean;
  timeSpent: number | null; // seconds, start to finish
  answerTime: number | null; // seconds answering, and what's typical for these items
  typicalTime: number | null;
  pastedAnswers: number;
  totalAnswers: number;
  awaiting: string[]; // codes of low-confidence or ungraded answers VFDA hasn't reviewed
  overrides: { code: string; from: number | null; to: number; points: number; note: string }[];
};

const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;

// The flags at length, for the PDF's Alerts box.
export function alertFlags(f: FlagInput): string[] {
  return [
    f.retake && "RETAKE: the first try stays the official score.",
    f.fastFinish &&
      (f.answerTime && f.typicalTime
        ? `Unusually fast finish: ${mins(f.answerTime)} answering vs. about ${mins(f.typicalTime)} typical for these questions.`
        : `Unusually fast finish${f.timeSpent ? ` (${mins(f.timeSpent)} in all)` : ""}: well under the typical time for these questions.`),
    f.pastedAnswers > 0 && `Pasting: ${f.pastedAnswers} of ${f.totalAnswers} answers had pasted text.`,
    f.awaiting.length > 0 &&
      `${f.awaiting.length} AI grade${f.awaiting.length === 1 ? "" : "s"} waiting for VFDA review (low confidence): ${f.awaiting.join(", ")}.`,
    ...f.overrides.map(
      (o) => `VFDA changed the score on ${o.code}: ${o.from === null ? "ungraded" : `${o.from}/${o.points}`} -> ${o.to}/${o.points}${o.note ? ` ("${o.note}")` : ""}.`,
    ),
  ].filter((x): x is string => !!x);
}

const MAX_COACHING = 240;
const MAX_CARD_TIP = 180;
const MAX_BULLETS = 4;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

// Critical errors first, then the lowest share of points, then quiz order.
export function orderNeedsWork<T extends Pick<NeedsWorkItem, "critical" | "score" | "points">>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        Number(b.item.critical) - Number(a.item.critical) ||
        (a.item.score ?? 0) / a.item.points - (b.item.score ?? 0) / b.item.points ||
        a.i - b.i,
    )
    .map((x) => x.item);
}

// AI_MODE=mock, or when Claude's answer can't be used: tips from the grading itself.
export function mockTips(needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): Tips {
  return {
    items: needsWork.map((i) => {
      const first = i.missed[0] ?? i.correct[0] ?? "the required steps";
      const coaching = i.critical
        ? `Stop and escalate next time: ${first}. Read the card's safety steps again before the next quiz.`
        : i.type === "mc"
          ? `Re-read the card on this: ${first}.`
          : `Next time, ${first.charAt(0).toLowerCase()}${first.slice(1)}${i.missed.length > 1 ? `, and ${i.missed.length - 1} more step(s) from the card` : ""}.`;
      // The card is silent when the scenario has no quote from it.
      const card = i.sourceQuote?.trim()
        ? null
        : `${i.sourceCard || `${i.workflowName} card`}: add a clear line on "${clip(first, 80)}".`;
      return { key: i.key, coaching, card };
    }),
    strengths: [...new Set(doneWell.map((d) => d.workflow))].map((workflow) => ({
      workflow,
      bullets: [...new Set(doneWell.filter((d) => d.workflow === workflow).map((d) => d.partTitle || d.correct[0] || "").filter(Boolean))]
        .slice(0, MAX_BULLETS)
        .map((t) => `Handled ${t.charAt(0).toLowerCase()}${t.slice(1)}`),
    })),
  };
}

// Claude's tips, kept to what the PDF needs; anything missing or unusable
// comes from the mock tips.
export function checkTips(raw: Tips, needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): Tips {
  const fallback = mockTips(needsWork, doneWell);
  const workflows = new Set(doneWell.map((d) => d.workflow));
  return {
    items: fallback.items.map((f) => {
      const t = raw.items.find((x) => x.key === f.key);
      const coaching = t?.coaching?.trim();
      const card = t?.card?.trim();
      return {
        key: f.key,
        coaching: coaching ? clip(coaching, MAX_COACHING) : f.coaching,
        // An empty card tip, or one that says the card is fine, means "coaching only".
        card: !t ? f.card : card && !/^card is clear/i.test(card) ? clip(card, MAX_CARD_TIP) : null,
      };
    }),
    strengths: [...workflows].map((w) => {
      const bullets = (raw.strengths.find((s) => s.workflow === w)?.bullets ?? []).map((b) => clip(b, 140)).filter(Boolean);
      return { workflow: w, bullets: bullets.length ? bullets.slice(0, MAX_BULLETS) : (fallback.strengths.find((s) => s.workflow === w)?.bullets ?? []) };
    }),
  };
}

export function buildQuizReport(
  head: Omit<QuizReport, "needsWork" | "strengths" | "alerts" | "vaTips" | "standards">,
  needsWork: NeedsWorkItem[],
  doneWell: DoneWellItem[],
  tips: Tips,
  flags: string[] = [],
  vaTips: QuizReport["vaTips"] = null,
): QuizReport {
  const names = new Map([...needsWork, ...doneWell].map((i) => [i.workflow, i.workflowName]));
  const ordered = orderNeedsWork(needsWork).map((i) => {
    const t = tips.items.find((x) => x.key === i.key);
    return { ...i, coaching: t?.coaching ?? "", cardTip: t?.card ?? CARD_IS_CLEAR };
  });
  return {
    ...head,
    vaTips: vaTips && { ...vaTips, tags: vaTipTags(vaTips.tips, needsWork) },
    standards: standardsUsed([...needsWork, ...doneWell].map((i) => i.ruleSource)),
    alerts: {
      critical: ordered
        .filter((i) => i.critical)
        .map((i) => ({
          code: i.code,
          topic: i.partTitle || i.workflowName,
          quote: i.criticalQuote ?? "",
          why: i.criticalFail?.trim() || "The answer did something the scenario lists as a critical fail.",
          coaching: i.coaching,
        })),
      flags,
    },
    needsWork: ordered,
    strengths: tips.strengths
      .filter((s) => s.bullets.length)
      .map((s) => ({ workflow: s.workflow, name: names.get(s.workflow) ?? s.workflow, bullets: s.bullets })),
  };
}

// The required steps of a scenario, for the tips and the evaluation.
export const correctSteps = (correctResponse: unknown) => requiredSteps(correctResponse);

// The evaluation line: score, then what was missed or wrong.
export function evaluationText(i: Pick<NeedsWorkItem, "score" | "points" | "reason" | "missed" | "type">) {
  const score = i.score === null ? "Not graded yet (VFDA reviews it)" : `${i.score}/${i.points}`;
  return [score, i.reason.trim()].filter(Boolean).join(" – ");
}

// The Leads4Life payload for one doctor.
export type Leads4LifePayload = {
  doctor_email: string;
  doctor_name: string;
  office: string;
  va_name: string;
  day: string;
  topic: string;
  result: string;
  first_try_score: string; // "72%"
  is_retake: "yes" | "no";
  report_link: string;
  critical_errors: number;
  flags: string; // short, e.g. "fast finish, 3 pasted answers"; "none" when there are none
  trend: string; // e.g. "improving, +12 pts"; "first day" before there's a trend
};

export const reportFileName = (r: Pick<QuizReport, "vaName" | "dayCode" | "retake">) =>
  `Quiz report - ${r.vaName} - ${r.dayCode}${r.retake ? " retake" : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");

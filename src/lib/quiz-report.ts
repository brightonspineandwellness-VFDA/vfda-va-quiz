// The quiz report of one finished attempt (a day, a retake or a drill), as
// pure functions: what goes in it, the mock tips (AI_MODE=mock), and the check
// on Claude's tips. src/lib/quiz-reports.ts loads the data, asks Claude and
// stores the PDF; src/lib/quiz-report-pdf.ts draws it; the VFDA email and
// Slack post (src/lib/report.ts) show the same sections.
//
// Sections, in order: score + label, What went well (the biggest section),
// Things to focus on, Important to review (critical errors only), flags, the
// VFDA standards notice, then (doctor/VFDA only) Trello card suggestions and
// the coaching tips given to the VA. No scenarios and no VA answers: the
// attempt page in the app shows those. Warm, never shaming.

import { requiredSteps } from "@/lib/mock-grade";
import { standardsUsed, tipTagOf, vaTipTags, type ItemRuleSource, type TipTag } from "@/lib/rule-source";

export type NeedsWorkItem = {
  key: string; // the item's position, for matching Claude's tips
  code: string;
  workflow: string;
  workflowName: string;
  type: "mc" | "situational" | "describe";
  points: number;
  score: number | null; // null: not graded yet
  // The question as the VA saw it, and their exact words. Given to Claude to
  // write the tips; never printed in a report.
  scenario: string;
  answer: string;
  // From grading: why, what they did well, and what to focus on. Multiple choice: the right option.
  reason: string;
  didWell: string;
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

export type DoneWellItem = {
  workflow: string;
  workflowName: string;
  partTitle: string;
  correct: string[];
  sourceCard?: string | null;
  // The grader's "what you did well" line (graded with the current rubric).
  didWell?: string;
  ruleSource?: ItemRuleSource | null;
};

export type Tips = {
  items: { key: string; coaching: string; card: string | null }[];
  // What went well, grouped by workflow.
  strengths: { workflow: string; bullets: string[] }[];
};

// "Things to focus on": what to do next time, the card to review, its tag.
export type FocusLine = { code: string; text: string; card: string; tag: TipTag | null };

// "Important to review": one per critical error, calm. `quote` (the VA's
// words) is for the doctor/VFDA report only.
export type ImportantLine = { code: string; topic: string; text: string; card: string; quote: string; why: string };

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
  // The other score beside this one: a day's retake, or a retake's first try (official).
  otherScore: { caption: string; points: number; max: number } | null;
  wentWell: { workflow: string; name: string; bullets: string[] }[];
  focus: FocusLine[];
  // Below full points but not in Things to focus on (more than the 5 shown).
  moreFocus: number;
  important: ImportantLine[];
  // Flags at length (fast finish, pasting, grades awaiting review, VFDA score changes, retake).
  flags: string[];
  // The VFDA standard rules any item relied on (the notice); empty: no notice.
  standards: string[];
  // Trello card suggestions for the doctor (short list).
  cardTips: string[];
  // "Coaching tips given to the VA" (va_reports); null before they're written.
  // tags: each tip's "VFDA standard" / "Card: ..." tag.
  vaTips: { alerts: string[]; tips: string[]; strengths: string[]; tags?: (TipTag | null)[] } | null;
};

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

// The flags at length, for the doctor/VFDA report.
export function alertFlags(f: FlagInput): string[] {
  return [
    f.retake && "Retake: the first try stays the official score.",
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

const MAX_COACHING = 260;
const MAX_CARD_TIP = 180;
const MAX_BULLET = 170;
export const MAX_FOCUS = 5;
const MAX_CARD_TIPS = 5;
// What went well: 4-8 bullets in all, more when the result is Great work or Building skills.
export const wentWellRange = (resultLabel: string) => (/extra support|risk/i.test(resultLabel) ? { min: 4, max: 6 } : { min: 6, max: 8 });
const PER_WORKFLOW = 4;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s: string) => s.trim().replace(/[.\s]+$/, "") + ".";

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

// The card to review for an item: the scenario's source card, else the workflow's card.
export const cardOf = (i: Pick<NeedsWorkItem, "sourceCard" | "workflowName">) => i.sourceCard?.trim() || `${i.workflowName} card`;
const topicOf = (i: Pick<NeedsWorkItem, "partTitle" | "workflowName">) => i.partTitle?.trim() || i.workflowName;

// "you handled" -> "handled": the grader's lines are to the VA; the doctor's bullets start with the skill.
const thirdPerson = (s: string) =>
  upper(
    s
      .trim()
      .replace(/^(great job|nice work|well done|good job)[,!:]?\s*/i, "")
      .replace(/^you\s+(did a (great|good) job\s+)?/i, "")
      .replace(/\byour\b/gi, "their")
      .replace(/\byou\b/gi, "they"),
  );

// AI_MODE=mock, or when Claude's answer can't be used: tips from the grading itself.
export function mockTips(needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): Tips {
  const strengths = new Map<string, string[]>();
  const add = (workflow: string, line: string) => strengths.set(workflow, [...(strengths.get(workflow) ?? []), line]);
  for (const d of doneWell) {
    const skill = d.partTitle.trim() || d.correct[0] || d.workflowName;
    add(d.workflow, `Handled ${lower(skill)} with every key step${d.sourceCard?.trim() ? `, just like the ${d.sourceCard.trim()} card` : ""}`);
  }
  for (const i of needsWork) if (i.didWell.trim()) add(i.workflow, thirdPerson(i.didWell));
  return {
    items: needsWork.map((i) => {
      const first = i.missed[0] ?? i.correct[0] ?? "the key steps";
      const coaching = i.critical
        ? `When this comes up, start with the safety step first: ${lower(first)}.`
        : i.type === "mc"
          ? `Keep in mind: ${lower(first)}.`
          : `Next time, ${lower(first)}${i.missed.length > 1 ? `, and keep the card's other steps in mind` : ""}.`;
      // The card is silent when the scenario has no quote from it.
      const card = i.sourceQuote?.trim() ? null : `${cardOf(i)}: add a clear line on "${clip(first, 80)}".`;
      return { key: i.key, coaching, card };
    }),
    strengths: [...strengths].map(([workflow, bullets]) => ({ workflow, bullets: [...new Set(bullets)].slice(0, PER_WORKFLOW) })),
  };
}

// At most `max` bullets in all, taking from each workflow in turn.
function capBullets(groups: { workflow: string; bullets: string[] }[], max: number) {
  const out = groups.map((g) => ({ workflow: g.workflow, bullets: [] as string[] }));
  let left = max;
  for (let round = 0; left > 0; round++) {
    let took = false;
    groups.forEach((g, n) => {
      if (left > 0 && g.bullets[round]) {
        out[n].bullets.push(g.bullets[round]);
        left--;
        took = true;
      }
    });
    if (!took) break;
  }
  return out.filter((g) => g.bullets.length);
}

// Claude's tips, kept to what the report needs; anything missing or unusable
// comes from the mock tips.
export function checkTips(raw: Tips, needsWork: NeedsWorkItem[], doneWell: DoneWellItem[], resultLabel = ""): Tips {
  const fallback = mockTips(needsWork, doneWell);
  const workflows = [...new Set([...doneWell.map((d) => d.workflow), ...needsWork.map((i) => i.workflow)])];
  const strengths = workflows
    .map((w) => {
      const bullets = (raw.strengths.find((s) => s.workflow === w)?.bullets ?? []).map((b) => clip(b, MAX_BULLET)).filter(Boolean);
      return { workflow: w, bullets: (bullets.length ? bullets : (fallback.strengths.find((s) => s.workflow === w)?.bullets ?? [])).slice(0, PER_WORKFLOW) };
    })
    .filter((g) => g.bullets.length);
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
    strengths: capBullets(strengths, wentWellRange(resultLabel).max),
  };
}

// " Review: <card>." on the end of a line, unless it's there already.
export const withReview = (text: string, card: string) => (/review:/i.test(text) ? sentence(text) : `${sentence(text)} Review: ${card}.`);

export function buildQuizReport(
  head: Omit<QuizReport, "wentWell" | "focus" | "moreFocus" | "important" | "flags" | "standards" | "cardTips" | "vaTips">,
  needsWork: NeedsWorkItem[],
  doneWell: DoneWellItem[],
  tips: Tips,
  flags: string[] = [],
  vaTips: QuizReport["vaTips"] = null,
): QuizReport {
  const names = new Map([...needsWork, ...doneWell].map((i) => [i.workflow, i.workflowName]));
  const coachingOf = (i: NeedsWorkItem) => tips.items.find((x) => x.key === i.key);
  const ordered = orderNeedsWork(needsWork);
  const focusItems = ordered.filter((i) => !i.critical);
  return {
    ...head,
    vaTips: vaTips && { ...vaTips, tags: vaTipTags(vaTips.tips, needsWork) },
    standards: standardsUsed([...needsWork, ...doneWell].map((i) => i.ruleSource)),
    wentWell: tips.strengths
      .filter((s) => s.bullets.length)
      .map((s) => ({ workflow: s.workflow, name: names.get(s.workflow) ?? s.workflow, bullets: s.bullets })),
    focus: focusItems.slice(0, MAX_FOCUS).map((i) => ({
      code: i.code,
      text: withReview(coachingOf(i)?.coaching || `Next time, keep the card's steps for ${lower(topicOf(i))} in mind`, cardOf(i)),
      card: cardOf(i),
      tag: tipTagOf(i.ruleSource, i.sourceCard),
    })),
    moreFocus: Math.max(0, focusItems.length - MAX_FOCUS),
    important: ordered
      .filter((i) => i.critical)
      .map((i) => ({
        code: i.code,
        topic: topicOf(i),
        text: withReview(coachingOf(i)?.coaching || `When this comes up, always start with the safety steps on the card`, cardOf(i)),
        card: cardOf(i),
        quote: i.criticalQuote ?? "",
        why: i.criticalFail?.trim() || "The answer did something the scenario lists as a critical fail.",
      })),
    flags,
    cardTips: [...new Set(ordered.map((i) => coachingOf(i)?.card).filter((c): c is string => !!c))].slice(0, MAX_CARD_TIPS),
  };
}

// The required steps of a scenario, for the tips.
export const correctSteps = (correctResponse: unknown) => requiredSteps(correctResponse);

// "16 of 20 points (80%)"
export const scoreLine = (points: number, max: number) => `${points} of ${max} points (${max ? Math.round((points * 100) / max) : 0}%)`;

// The Leads4Life payload for one doctor.
export type Leads4LifePayload = {
  doctor_email: string;
  doctor_name: string;
  office: string;
  va_name: string;
  day: string;
  topic: string;
  result: string; // "Great work", "Building skills" or "Needs extra support"
  first_try_score: string; // "72%"
  raw_score: string; // "16/20"
  is_retake: "yes" | "no";
  report_link: string;
  critical_errors: number;
  flags: string; // short, e.g. "fast finish, 3 pasted answers"; "none" when there are none
  // For the doctor's email: "[VA name] finished [day]: [label]".
  email_subject: string;
};

export const reportFileName = (r: Pick<QuizReport, "vaName" | "dayCode" | "retake">) =>
  `Quiz report - ${r.vaName} - ${r.dayCode}${r.retake ? " retake" : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");

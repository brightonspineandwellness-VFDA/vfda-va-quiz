// The VA report: the VA-safe version of a quiz report (My results -> My
// report, and its PDF). Pure functions: the fallback tips, the check on
// Claude's tips, and the shape sent to the VA's page. src/lib/va-reports.ts
// loads the data, asks Claude and stores the text in va_reports.
//
// The VA never sees the scenarios, their answers, the correct answers, the
// critical fail text, VFDA notes, the doctor's Trello card tips or anything
// from the office gap report. Only the fields of VaReportView leave the server.

import { orderNeedsWork, type DoneWellItem, type NeedsWorkItem } from "@/lib/quiz-report";

// What's written for the VA (va_reports.alerts / tips / strengths).
export type VaTips = {
  alerts: string[]; // each critical error, in general terms
  tips: string[]; // most important first (critical errors at the top)
  strengths: string[]; // 1-2
};

export type VaReportView = {
  attemptId: string;
  dayCode: string;
  topic: string;
  date: string; // ISO
  retake: boolean;
  percent: number; // first try (a retake: the retake's own score)
  resultLabel: string;
  timeSpent: number | null; // seconds
  // A day with a retake: the retake's score beside it. A retake: its day's first try.
  retakePercent: number | null;
  firstTryPercent: number | null;
  alerts: string[];
  flags: string[];
  trend: { rows: { day: string; percent: number; current: boolean }[]; direction: "improving" | "steady" | "declining" | null };
  tips: string[];
  strengths: string[];
  ready: boolean; // false: the tips aren't written yet
};

export const MAX_TIPS = 6; // with the strengths
const MAX_STRENGTHS = 2;
const MAX_LINE = 500;

const clip = (s: string, n = MAX_LINE) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

// The card a VA reviews for an item: the scenario's source card, else the workflow's card.
export const cardOf = (i: Pick<NeedsWorkItem, "sourceCard" | "workflowName">) => i.sourceCard?.trim() || `${i.workflowName} card`;

const topicOf = (i: Pick<NeedsWorkItem, "partTitle" | "workflowName">) => i.partTitle?.trim() || i.workflowName;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// Items lost points on, grouped by the card to review, most important first.
export function tipGroups(needsWork: NeedsWorkItem[]) {
  const groups: { card: string; items: NeedsWorkItem[] }[] = [];
  for (const i of orderNeedsWork(needsWork)) {
    const card = cardOf(i);
    const g = groups.find((x) => x.card === card);
    if (g) g.items.push(i);
    else groups.push({ card, items: [i] });
  }
  return groups;
}

const tipRoom = (strengths: number) => Math.max(1, MAX_TIPS - strengths);

// AI_MODE=mock, or when Claude's answer can't be used: tips from the grading itself.
export function fallbackVaTips(needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): VaTips {
  const strengths = [...new Set(doneWell.map((d) => d.partTitle.trim() || d.workflowName))]
    .slice(0, MAX_STRENGTHS)
    .map((t) => `You handled ${lower(t)} well. Keep doing it the same way.`);
  if (!strengths.length) strengths.push("You finished the whole quiz. Keep going: every day builds on this one.");
  const groups = tipGroups(needsWork);
  return {
    alerts: orderNeedsWork(needsWork)
      .filter((i) => i.critical)
      .map((i) => `Critical error on ${lower(topicOf(i))}: a safety step the office requires was missed.`),
    tips: groups.slice(0, tipRoom(strengths.length)).map((g) => {
      const topics = [...new Set(g.items.map(topicOf))];
      const critical = g.items.some((i) => i.critical);
      return `${critical ? "Most important: " : ""}Some steps were missed in ${topics.length === 1 ? "this topic" : `${topics.length} topics`} (${topics.join("; ")}). Next time, go through the card's steps in order before you answer. Review: ${g.card} – the steps for ${topics.length === 1 ? lower(topics[0]) : "these topics"}.`;
    }),
    strengths,
  };
}

// Words, for spotting text copied from a scenario or an answer.
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

// True when `text` repeats 8 words in a row from any of `sources`.
export function copiesFrom(text: string, sources: string[], run = 8): boolean {
  const t = ` ${words(text).join(" ")} `;
  for (const src of sources) {
    const w = words(src);
    for (let k = 0; k + run <= w.length; k++) {
      if (t.includes(` ${w.slice(k, k + run).join(" ")} `)) return true;
    }
  }
  return false;
}

export type RawVaTips = {
  alerts: { key: string; text: string }[];
  tips: { keys: string[]; text: string; card: string; section: string }[];
  strengths: string[];
};

// Claude's tips, kept to what the VA may see. A line that copies the scenario
// or the VA's answer, names a card that isn't one of theirs, or is empty is
// replaced by the fallback line.
export function checkVaTips(raw: RawVaTips, needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): VaTips {
  const fallback = fallbackVaTips(needsWork, doneWell);
  // Never echo the scenario, the VA's words or the critical fail. (What to do
  // next time naturally overlaps the card's steps, so those aren't checked.)
  const secret = needsWork.flatMap((i) => [i.scenario, i.answer, i.criticalFail ?? "", i.criticalQuote ?? ""]);
  const safe = (s: string | undefined) => {
    const t = clip(s ?? "");
    return t && !copiesFrom(t, secret) ? t : null;
  };
  const critical = orderNeedsWork(needsWork).filter((i) => i.critical);
  const alerts = critical.map((i, n) => safe(raw.alerts.find((a) => a.key === i.key)?.text) ?? fallback.alerts[n]);

  const strengths = raw.strengths.map((s) => safe(s)).filter((s): s is string => !!s).slice(0, MAX_STRENGTHS);
  const finalStrengths = strengths.length ? strengths : fallback.strengths;

  const groups = tipGroups(needsWork);
  const cards = new Set(groups.map((g) => g.card.toLowerCase()));
  const used = new Set<string>();
  const tips: string[] = [];
  // Claude's order, but every critical error's card first.
  const criticalKeys = new Set(critical.map((i) => i.key));
  const ordered = [...raw.tips].sort(
    (a, b) => Number(b.keys.some((k) => criticalKeys.has(k))) - Number(a.keys.some((k) => criticalKeys.has(k))),
  );
  for (const t of ordered) {
    const text = safe(t.text);
    const card = t.card?.trim();
    if (!text || !card || !cards.has(card.toLowerCase()) || used.has(card.toLowerCase())) continue;
    used.add(card.toLowerCase());
    const section = t.section?.trim() ? ` – ${clip(t.section, 120)}` : "";
    tips.push(`${text.replace(/[.\s]+$/, "")}. Review: ${card}${section}.`);
  }
  // A card Claude left out gets the fallback line.
  groups.forEach((g, n) => {
    if (!used.has(g.card.toLowerCase())) tips.push(fallback.tips[n] ?? fallbackVaTips([...g.items], []).tips[0]);
  });
  return { alerts, tips: tips.slice(0, tipRoom(finalStrengths.length)), strengths: finalStrengths };
}

// The flags a VA sees: fast finish and pasted answers only.
export function vaFlags(f: { fastFinish: boolean; pastedAnswers: number; totalAnswers: number }): string[] {
  return [
    f.fastFinish && "You finished much faster than usual. Take time to read each question and think through every step.",
    f.pastedAnswers > 0 &&
      `${f.pastedAnswers} of ${f.totalAnswers} answers had pasted text. Write each answer in your own words: that's how the steps stick.`,
  ].filter((x): x is string => !!x);
}

export const TREND_LINE: Record<"improving" | "steady" | "declining", string> = {
  improving: "Improving: your first-try scores are going up.",
  steady: "Steady: your first-try scores are about the same.",
  declining: "Declining: your first-try scores have dropped. Slow down and review the cards before each quiz.",
};

// One line per report in the VA's email.
export const vaReportLine = (r: { dayCode: string; topic: string; retake: boolean; percent: number; resultLabel: string }) =>
  `${r.dayCode}${r.retake ? " RETAKE" : ""}${r.topic ? ` – ${r.topic}` : ""}: ${r.percent}% first try, ${r.resultLabel}`;

// Admin edits: one line per bullet.
export const linesOf = (s: string, max: number) =>
  s
    .split(/\r?\n/)
    .map((l) => clip(l.replace(/^\s*[-•*]\s*/, ""), 600))
    .filter(Boolean)
    .slice(0, max);

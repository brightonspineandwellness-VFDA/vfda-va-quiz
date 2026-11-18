// The VA report: the VA-safe version of a quiz report (My results -> My
// report, and its PDF). Pure functions: the fallback text, the check on
// Claude's text, and the shape sent to the VA's page. src/lib/va-reports.ts
// loads the data, asks Claude and stores the text in va_reports.
//
// No scores, ever (no points, percentages, "X of Y" or per-question scores).
// Sections, in order: Completed ✓ + label + "Day X of Y completed", Skills
// you showed (a checkmark list by workflow), Skills to practice (2-5, each
// with "Review: <card>" and the VFDA standard tag), Important to review (only
// with a critical error, calm), a small tip (gentle flags), the VFDA
// standards notice, and an encouraging line about the next day.
//
// The VA never sees the scenarios, their answers (or quotes of them), the
// correct answers, the critical fail text, VFDA notes, the doctor's Trello
// card tips or anything from the office gap report. Only the fields of
// VaReportView leave the server.

import { cardOf, orderNeedsWork, withReview, type DoneWellItem, type NeedsWorkItem } from "@/lib/quiz-report";
import type { TipTag } from "@/lib/rule-source";
import type { ResultLabel } from "@/lib/va-flow";
import { shortSkill, type WentWellGroup } from "@/lib/skills";

export { cardOf };
export { groupStrengths, parseStrength, shortSkill, skillCount, skillsOf, type WentWellGroup } from "@/lib/skills";

// What's written for the VA (va_reports.alerts / tips / strengths).
// strengths: "[Workflow name] bullet" lines (the group in brackets); older
// reports have plain lines.
export type VaTips = {
  alerts: string[]; // "Important to review": each critical error, calm, general terms, ends "Review: <card>."
  tips: string[]; // "Skills to practice", most important first, each ends "Review: <card> ..."
  strengths: string[]; // full sentences about what went well, 4-8 (the first is the report's highlight)
  // "Skills you showed": short names, "[Workflow name] Verifying callers".
  // Older reports have none: they come from the strengths (skillsOf).
  skills?: string[];
};

export type VaReportView = {
  attemptId: string;
  vaName: string;
  officeName: string;
  dayCode: string;
  topic: string;
  date: string; // ISO
  retake: boolean;
  result: ResultLabel;
  resultLabel: string;
  // "Day X of Y completed" (null: not known).
  progress: { done: number; total: number } | null;
  // "Skills you showed", grouped by workflow, and one sentence on the best of them.
  skills: WentWellGroup[];
  highlight: string | null;
  tips: string[];
  // Each tip's tag: "VFDA standard" or "Card: <name>" (null: none).
  tipTags: (TipTag | null)[];
  important: string[];
  flags: string[];
  // The VFDA standard rules the quiz relied on, rules only (no scenarios or
  // answers); empty: no notice.
  standards: string[];
  // The encouraging last line.
  closing: string;
  ready: boolean; // false: the text isn't written yet
};

export const MAX_TIPS = 5;
export const MAX_STRENGTHS = 8;
const MAX_LINE = 500;

const clip = (s: string, n = MAX_LINE) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

const topicOf = (i: Pick<NeedsWorkItem, "partTitle" | "workflowName">) => i.partTitle?.trim() || i.workflowName;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// Items below full points that aren't critical errors, grouped by the card to
// review and the topic (so one card can give several focus tips), most important first.
export function tipGroups(needsWork: NeedsWorkItem[]) {
  const groups: { card: string; topic: string; items: NeedsWorkItem[] }[] = [];
  for (const i of orderNeedsWork(needsWork).filter((x) => !x.critical)) {
    const card = cardOf(i);
    const topic = topicOf(i);
    const g = groups.find((x) => x.card === card && x.topic.toLowerCase() === topic.toLowerCase());
    if (g) g.items.push(i);
    else groups.push({ card, topic, items: [i] });
  }
  return groups;
}

// AI_MODE=mock, or when Claude's answer can't be used: text from the grading itself.
export function fallbackVaTips(needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): VaTips {
  const strengths = [
    ...doneWell.map((d) => {
      const skill = d.partTitle.trim() || d.workflowName;
      return `[${d.workflowName}] ${d.didWell?.trim() || `You handled ${lower(skill)} with every key step${d.sourceCard?.trim() ? `, just like the ${d.sourceCard.trim()} card` : ""}.`}`;
    }),
    ...needsWork.filter((i) => i.didWell.trim()).map((i) => `[${i.workflowName}] ${i.didWell.trim()}`),
  ];
  const unique = [...new Set(strengths)].slice(0, MAX_STRENGTHS);
  if (!unique.length) unique.push("You finished every question in the quiz. That steady effort is how these skills grow.");
  const skills = [
    ...new Set([
      ...doneWell.map((d) => `[${d.workflowName}] ${(d.partTitle.trim() || d.workflowName).replace(/^./, (c) => c.toUpperCase())}`),
      ...needsWork.filter((i) => i.didWell.trim()).map((i) => `[${i.workflowName}] ${shortSkill(i.didWell)}`),
    ]),
  ].slice(0, MAX_STRENGTHS);
  return {
    skills,
    alerts: orderNeedsWork(needsWork)
      .filter((i) => i.critical)
      .map((i) => withReview(`When ${lower(topicOf(i))} comes up, always start with the safety steps first`, cardOf(i))),
    tips: tipGroups(needsWork)
      .slice(0, MAX_TIPS)
      .map((g) => {
        const first = g.items.flatMap((i) => i.missed)[0];
        const what = first ? lower(first.replace(/[.\s]+$/, "")) : `go through the card's steps for ${lower(g.topic)} in order`;
        return `${what.charAt(0).toUpperCase()}${what.slice(1)}. Review: ${g.card} – ${lower(g.topic)}.`;
      }),
    strengths: unique,
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
  alerts: { key: string; text: string; card: string }[];
  tips: { keys: string[]; text: string; card: string; section: string }[];
  strengths: { workflow: string; skill?: string; text: string }[];
};

// Never on a VA screen.
const HARSH = /\b(wrong|failed|fail|missed|missing)\b/i;

// Claude's text, kept to what the VA may see. A line that copies the scenario
// or the VA's answer, names a card that isn't one of theirs, uses harsh words,
// or is empty is replaced by the fallback line.
export function checkVaTips(raw: RawVaTips, needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): VaTips {
  const fallback = fallbackVaTips(needsWork, doneWell);
  // Never echo the scenario, the VA's words or the critical fail. (What to do
  // next time naturally overlaps the card's steps, so those aren't checked.)
  const secret = needsWork.flatMap((i) => [i.scenario, i.answer, i.criticalFail ?? "", i.criticalQuote ?? ""]);
  const safe = (s: string | undefined) => {
    const t = clip(s ?? "");
    return t && !copiesFrom(t, secret) && !HARSH.test(t) ? t : null;
  };
  const critical = orderNeedsWork(needsWork).filter((i) => i.critical);
  const alerts = critical.map((i, n) => {
    const a = raw.alerts.find((x) => x.key === i.key);
    const text = safe(a?.text);
    return text ? withReview(text, cardOf(i)) : fallback.alerts[n];
  });

  const workflows = new Set([...doneWell, ...needsWork].map((d) => d.workflowName.toLowerCase()));
  const kept = raw.strengths.filter((s) => safe(s.text));
  const skills = [
    ...new Set(
      kept
        .map((s) => {
          const name = clip(s.skill ?? "", 60).replace(/[.\s]+$/, "") || shortSkill(s.text);
          const group = s.workflow?.trim();
          return name && !HARSH.test(name) ? `${group && workflows.has(group.toLowerCase()) ? `[${group}] ` : ""}${name.charAt(0).toUpperCase()}${name.slice(1)}` : null;
        })
        .filter((s): s is string => !!s),
    ),
  ].slice(0, MAX_STRENGTHS);
  const strengths = raw.strengths
    .map((s) => {
      const text = safe(s.text);
      const group = s.workflow?.trim();
      if (!text) return null;
      return group && workflows.has(group.toLowerCase()) ? `[${group}] ${text}` : text;
    })
    .filter((s): s is string => !!s)
    .slice(0, MAX_STRENGTHS);
  const finalStrengths = strengths.length >= 2 ? strengths : fallback.strengths;

  const groups = tipGroups(needsWork);
  const cards = new Set(groups.map((g) => g.card.toLowerCase()));
  const focusKeys = new Set(groups.flatMap((g) => g.items.map((i) => i.key)));
  const covered = new Set<string>();
  const tips: string[] = [];
  for (const t of raw.tips) {
    const text = safe(t.text);
    const card = t.card?.trim();
    const keys = (t.keys ?? []).filter((k) => focusKeys.has(k));
    // A tip must name one of the VA's cards and cover something not covered yet.
    if (!text || !card || !cards.has(card.toLowerCase()) || !keys.length || keys.every((k) => covered.has(k))) continue;
    keys.forEach((k) => covered.add(k));
    const section = t.section?.trim() ? ` – ${clip(t.section, 120)}` : "";
    tips.push(`${text.replace(/\s*review:.*$/i, "").replace(/[.\s]+$/, "")}. Review: ${card}${section}.`);
  }
  // A group Claude left out gets the fallback line.
  groups.forEach((g, n) => {
    if (!g.items.some((i) => covered.has(i.key))) tips.push(fallback.tips[n] ?? fallbackVaTips([...g.items], []).tips[0]);
  });
  return { alerts, tips: tips.slice(0, MAX_TIPS), strengths: finalStrengths, skills: strengths.length >= 2 && skills.length >= 2 ? skills : fallback.skills };
}

// The flags a VA sees, gently ("A small tip"): fast finish and pasted answers only.
export function vaFlags(f: { fastFinish: boolean; pastedAnswers: number; totalAnswers: number }): string[] {
  return [
    f.fastFinish && "Take your time with each question next time; there's no rush, and thinking it through helps the steps stick.",
    f.pastedAnswers > 0 && "Try to write your answers in your own words next time. It helps us see how you think.",
  ].filter((x): x is string => !!x);
}

// The encouraging last line of the VA report.
export const CLOSING: Record<ResultLabel, string> = {
  strong: "You're doing great. Keep this momentum going into your next day!",
  needs_coaching: "You're building real skills. Take one of these focus points into your next day and keep going!",
  at_risk: "Every day builds on the last. Review the cards above, and you'll feel more confident in your next day. You've got this!",
};

// One line per report in the VA's email: completed + label, never a score.
export const vaReportLine = (r: { dayCode: string; topic: string; retake: boolean; resultLabel: string }) =>
  `${r.dayCode}${r.retake ? " (practiced again)" : ""}${r.topic ? ` – ${r.topic}` : ""}: Completed ✓, ${r.resultLabel}`;

// Admin edits: one line per bullet.
export const linesOf = (s: string, max: number) =>
  s
    .split(/\r?\n/)
    .map((l) => clip(l.replace(/^\s*[-•*]\s*/, ""), 600))
    .filter(Boolean)
    .slice(0, max);

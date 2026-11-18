// The 4-week doctor training program, as pure functions: the 8-session plan
// (2 a week; each pairs one focus area with one strength, preferably from a
// different day, safety first), the scenario mix (3 focus + 2 strength, then
// 2 + 3, so the program is 50/50), the fallback bank and sheet (AI_MODE=mock,
// or when Claude's answer can't be used), and the check on Claude's sheet.
// src/lib/training-program.ts loads the data, asks Claude, stores and sends.

import type { TrainingBank, TrainingSheet } from "@/lib/ai";

export const SESSIONS = 8;
export const WEEKS = 4;

export type Strength = { text: string; day: string; card: string };
export type FocusArea = {
  title: string;
  text: string;
  safety: boolean;
  why: string;
  days: string[];
  cards: string[];
  refs: string[];
  // VFDA standard rules its items were graded against (the office's cards were silent).
  standards: string[];
  workflows: string[];
};

export type Bank = {
  knows: Strength[];
  practice: FocusArea[];
  // Days the VA didn't take (not in their schedule, or not finished), as a sentence; null: none.
  notCovered: string | null;
  daysDone: number;
  daysTotal: number;
  overall: string; // the label most of their days got
  source: "ai" | "fallback";
};

export type PlannedSession = { number: number; week: number; focus: FocusArea; strength: Strength; recap: boolean };

export type Sheet = TrainingSheet;

// Safety first (in Claude's order), then the rest in Claude's order.
export const rankPractice = (p: FocusArea[]) => [...p.filter((x) => x.safety), ...p.filter((x) => !x.safety)];

// The 8 sessions. Focus areas in rank order (repeated from the top when there
// are fewer than 8); each gets an unused strength from a different day when
// possible. Weeks: sessions 1-2 in week 1, 3-4 in week 2, ...
export function planSessions(bank: Pick<Bank, "knows" | "practice">): PlannedSession[] {
  const focus = rankPractice(bank.practice);
  if (!focus.length) return [];
  const used = new Set<number>();
  const out: PlannedSession[] = [];
  for (let n = 0; n < SESSIONS; n++) {
    const f = focus[n % focus.length];
    const recap = n >= focus.length;
    const pick =
      bank.knows.findIndex((k, i) => !used.has(i) && !f.days.includes(k.day)) >= 0
        ? bank.knows.findIndex((k, i) => !used.has(i) && !f.days.includes(k.day))
        : bank.knows.findIndex((_, i) => !used.has(i));
    let strength: Strength;
    if (pick >= 0) {
      used.add(pick);
      strength = bank.knows[pick];
    } else strength = { text: "Recap: everything the VA has mastered", day: "All days", card: bank.knows[0]?.card ?? "" };
    out.push({ number: n + 1, week: Math.floor(n / 2) + 1, focus: recap ? { ...f, title: `Review: ${f.title}` } : f, strength, recap });
  }
  return out;
}

// Scenario kinds for a session: odd sessions 3 focus + 2 strength, even 2 + 3.
export const scenarioOrder = (number: number): ("focus" | "strength")[] =>
  number % 2 === 1 ? ["focus", "focus", "focus", "strength", "strength"] : ["focus", "focus", "strength", "strength", "strength"];

// The label most days got (ties: the better one).
export function overallLabel(labels: string[]): string {
  const order = ["On track", "Building skills", "Let's review together"];
  const count = (l: string) => labels.filter((x) => x === l).length;
  return [...order].sort((a, b) => count(b) - count(a) || order.indexOf(a) - order.indexOf(b))[0] ?? "On track";
}

// "Not covered": the days the VA didn't take.
export function notCoveredText(vaFirst: string, days: { code: string; title: string; reason: "not_scheduled" | "not_finished" }[]): string | null {
  if (!days.length) return null;
  const names = (r: string) =>
    days
      .filter((d) => d.reason === r)
      .map((d) => `${d.code} ${d.title}`)
      .join(", ");
  const parts = [
    names("not_scheduled") && `${names("not_scheduled")} ${days.filter((d) => d.reason === "not_scheduled").length === 1 ? "isn't" : "aren't"} in ${vaFirst}'s schedule`,
    names("not_finished") && `${names("not_finished")} ${days.filter((d) => d.reason === "not_finished").length === 1 ? "wasn't" : "weren't"} finished`,
  ].filter(Boolean);
  return `${parts.join("; ")}, so ${days.length === 1 ? "it isn't" : "they aren't"} in this plan.`;
}

// ---------------------------------------------------------------------------
// Claude's answers, checked; fallbacks
// ---------------------------------------------------------------------------

const clip = (s: string, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};
const HARSH = /\b(wrong|failed|fail)\b/i;
const SCORE = /\b\d+\s*(%|percent|points?|of \d+)\b/i;
const clean = (s: string, n: number) => {
  const t = clip(s, n);
  return t && !HARSH.test(t) && !SCORE.test(t) ? t : "";
};

export type BankItem = {
  ref: string;
  day: string;
  workflow: string;
  workflowName: string;
  card: string;
  topic: string;
  critical: boolean;
  missed: string[];
  correct: string[];
  standards: string[];
  full: boolean; // full points on the first try
  repeatFixed: boolean; // fully correct on the "one more try"
};

// Claude's bank, kept to what the plan needs; refs map back to the items for
// their workflows and VFDA standards.
export function checkBank(raw: TrainingBank, items: BankItem[], cards: string[]): Pick<Bank, "knows" | "practice"> {
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const cardOk = (c: string) => cards.find((x) => x.toLowerCase() === c.trim().toLowerCase()) ?? c.trim();
  const knows = raw.knows
    .map((k) => ({ text: clean(k.text, 200), day: clip(k.day, 20) || "All days", card: cardOk(k.card) }))
    .filter((k) => k.text)
    .slice(0, 8);
  const practice = raw.practice
    .map((p) => {
      const refs = (p.refs ?? []).filter((r) => byRef.has(r));
      const its = refs.map((r) => byRef.get(r)!);
      return {
        title: clean(p.title, 70),
        text: clean(p.text, 200),
        safety: !!p.safety || its.some((i) => i.critical),
        why: clean(p.why, 320),
        days: [...new Set([...(p.days ?? []).map((d) => clip(d, 12)), ...its.map((i) => i.day)])].filter(Boolean),
        cards: [...new Set([...(p.cards ?? []).map(cardOk), ...its.map((i) => i.card)])].filter(Boolean).slice(0, 3),
        refs,
        standards: [...new Set(its.flatMap((i) => i.standards))].slice(0, 3),
        workflows: [...new Set(its.map((i) => i.workflow))],
      };
    })
    .filter((p) => p.title && p.text)
    .slice(0, 8);
  return { knows, practice };
}

// AI_MODE=mock, or Claude's bank couldn't be used: from the items themselves.
export function fallbackBank(items: BankItem[], skills: { day: string; text: string; card: string }[]): Pick<Bank, "knows" | "practice"> {
  const knows: Strength[] = [];
  for (const s of skills) if (!knows.some((k) => k.text.toLowerCase() === s.text.toLowerCase())) knows.push(s);
  for (const i of items.filter((x) => x.full)) {
    const text = `${i.topic.charAt(0).toUpperCase()}${i.topic.slice(1)}: every key step, as the card asks`;
    if (!knows.some((k) => k.text === text)) knows.push({ text, day: i.day, card: i.card });
  }
  const fixed = items.filter((i) => i.repeatFixed).length;
  if (fixed >= 2) knows.push({ text: `Learns fast from feedback: ${fixed} questions that needed a second try were fully correct the second time`, day: "All days", card: "" });
  const groups = new Map<string, BankItem[]>();
  for (const i of items.filter((x) => !x.full)) {
    const key = `${i.card.toLowerCase()}|${i.topic.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const practice: FocusArea[] = [...groups.values()]
    .map((g) => ({
      title: clip(g[0].topic, 60),
      text: clip(g.flatMap((i) => i.missed)[0] ?? `Keep the card's steps for ${g[0].topic.toLowerCase()} in order`, 200),
      safety: g.some((i) => i.critical),
      why: `This came up ${g.length === 1 ? "once" : `${g.length} times`} (${[...new Set(g.map((i) => i.day))].join(", ")}).`,
      days: [...new Set(g.map((i) => i.day))],
      cards: [...new Set(g.map((i) => i.card))].slice(0, 3),
      refs: g.map((i) => i.ref),
      standards: [...new Set(g.flatMap((i) => i.standards))].slice(0, 3),
      workflows: [...new Set(g.map((i) => i.workflow))],
      n: g.length,
    }))
    .sort((a, b) => Number(b.safety) - Number(a.safety) || b.n - a.n)
    .slice(0, 8)
    .map((p) => {
      const out: FocusArea & { n?: number } = { ...p };
      delete out.n;
      return out;
    });
  return { knows: knows.slice(0, 8), practice };
}

// Claude's sheet, kept to the shape the PDF needs; anything missing comes from the fallback.
export function checkSheet(raw: TrainingSheet, fallback: Sheet, number: number): Sheet {
  const order = scenarioOrder(number);
  const pool = { focus: raw.scenarios.filter((s) => s.kind === "focus"), strength: raw.scenarios.filter((s) => s.kind === "strength") };
  const fb = { focus: fallback.scenarios.filter((s) => s.kind === "focus"), strength: fallback.scenarios.filter((s) => s.kind === "strength") };
  const scenarios = order.map((kind) => {
    const s = pool[kind].shift() ?? fb[kind].shift() ?? fallback.scenarios[0];
    return {
      kind,
      ask: clip(s.ask, 420),
      listenFor: s.listenFor.map((l) => clip(l, 160)).filter(Boolean).slice(0, 4),
      followUp: clip(s.followUp, 200),
      card: clip(s.card, 80),
    };
  });
  const wrapUp = raw.wrapUp.map((q) => clip(q, 200)).filter(Boolean).slice(0, 2);
  return {
    title: clean(raw.title, 70) || fallback.title,
    buildOn: clean(raw.buildOn, 90) || fallback.buildOn,
    summary: clean(raw.summary, 600) || fallback.summary,
    explain: raw.explain.map((e) => clip(e, 200)).filter(Boolean).slice(0, 3),
    scenarios,
    wrapUp: wrapUp.length === 2 ? wrapUp : fallback.wrapUp,
    emailLine: clean(raw.emailLine, 300) || fallback.emailLine,
  };
}

export function fallbackSheet(s: PlannedSession, vaFirst: string, steps: string[]): Sheet {
  const order = scenarioOrder(s.number);
  const focusCard = s.focus.cards[0] ?? "the office's card";
  const listen = (steps.length ? steps : [s.focus.text]).slice(0, 4);
  return {
    title: s.focus.title,
    buildOn: s.strength.text.charAt(0).toLowerCase() + s.strength.text.slice(1),
    summary: `${vaFirst} is strong at ${s.strength.text.charAt(0).toLowerCase()}${s.strength.text.slice(1).replace(/[.\s]+$/, "")}. One thing to tighten: ${s.focus.text.charAt(0).toLowerCase()}${s.focus.text.slice(1).replace(/[.\s]+$/, "")}. ${s.focus.why}`,
    explain: [s.focus.text, `Why it matters: it keeps patients safe and the schedule right.`],
    scenarios: order.map((kind, n) =>
      kind === "focus"
        ? {
            kind,
            ask: `A patient (fake name: Pat Example ${n + 1}) needs help with ${s.focus.title.toLowerCase()}. Walk me through exactly what you do and say.`,
            listenFor: listen,
            followUp: "What would you do differently if I wasn't available?",
            card: focusCard,
          }
        : {
            kind,
            ask: `Show me how you handle this: ${s.strength.text.charAt(0).toLowerCase()}${s.strength.text.slice(1).replace(/[.\s]+$/, "")}. Use a made-up patient.`,
            listenFor: ["Follows the card's steps in order", "Confirms it's saved and documented", "Keeps the patient informed"],
            followUp: "What's the one step people most often skip here?",
            card: s.strength.card || focusCard,
          },
    ),
    wrapUp: [`In one sentence, what's our rule for ${s.focus.title.toLowerCase()}?`, "What do you write down, and where?"],
    emailLine: `This session helps ${vaFirst} with ${s.focus.title.toLowerCase()}, building on what ${vaFirst} already does well.`,
  };
}

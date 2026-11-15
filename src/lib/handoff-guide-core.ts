// The handoff guide's skill bank as pure functions (src/lib/handoff-guide.ts
// loads the data and asks Claude): every skill the VA was quizzed on, once,
// labeled strength / still building / not on the cards, mixed across the
// meetings, and the mock prompts (AI_MODE=mock, or when Claude's answer
// can't be used).

import type { GuideMix, HandoffGuide } from "@/lib/handoff-guide-pdf";
import type { DoneWellItem, NeedsWorkItem } from "@/lib/quiz-report";
import { isVfdaSourceCard } from "@/lib/rule-source";

// Two check-ins a week for the first month.
export const MEETINGS = 8;
export const PER_MEETING = 4;

// One skill the VA was quizzed on, for the bank.
export type Candidate = {
  key: string;
  workflowName: string;
  topic: string;
  card: string;
  mix: GuideMix;
  steps: string[];
  toPractice: string[];
};

// Every skill the VA was quizzed on, once (by workflow and topic): a
// standard not on the cards wins, then still building, then strength.
export function candidatesOf(needsWork: NeedsWorkItem[], doneWell: DoneWellItem[]): Candidate[] {
  const out = new Map<string, Candidate>();
  const rank: Record<GuideMix, number> = { not_on_cards: 3, building: 2, strength: 1 };
  const add = (i: NeedsWorkItem | DoneWellItem, building: boolean) => {
    const topic = i.partTitle?.trim() || i.workflowName;
    const key = `${i.workflow}|${topic.toLowerCase()}`;
    const standard = i.ruleSource?.kind === "vfda_standard" || (!i.ruleSource && isVfdaSourceCard(i.sourceCard));
    const mix: GuideMix = standard ? "not_on_cards" : building ? "building" : "strength";
    const card = standard && !i.ruleSource?.card ? "VFDA standard" : i.ruleSource?.card?.trim() || i.sourceCard?.trim() || `${i.workflowName} card`;
    const prev = out.get(key);
    const toPractice = building ? ((i as NeedsWorkItem).missed ?? []) : [];
    if (prev) {
      if (rank[mix] > rank[prev.mix]) prev.mix = mix;
      prev.toPractice = [...new Set([...prev.toPractice, ...toPractice])];
      if (!prev.steps.length) prev.steps = i.correct;
      return;
    }
    out.set(key, { key: String(out.size + 1), workflowName: i.workflowName, topic, card, mix, steps: i.correct.slice(0, 6), toPractice });
  };
  for (const d of doneWell) add(d, false);
  for (const n of needsWork) add(n, true);
  return [...out.values()];
}

// Mixes the kinds across meetings: each meeting takes one of each in turn.
export function interleave(c: Candidate[], total: number): Candidate[] {
  const queues: Candidate[][] = (["building", "not_on_cards", "strength"] as GuideMix[]).map((m) => c.filter((x) => x.mix === m));
  const out: Candidate[] = [];
  while (out.length < total && queues.some((q) => q.length)) for (const q of queues) if (q.length && out.length < total) out.push(q.shift()!);
  return out;
}

const lower = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

// AI_MODE=mock, or when Claude's answer can't be used.
export function mockMeetings(candidates: Candidate[]): HandoffGuide["meetings"] {
  const picked = interleave(candidates, MEETINGS * PER_MEETING);
  const perMeeting = Math.max(1, Math.min(PER_MEETING, Math.ceil(picked.length / MEETINGS)));
  const meetings: HandoffGuide["meetings"] = [];
  for (let i = 0; i < picked.length; i += perMeeting) {
    meetings.push({
      title: "",
      skills: picked.slice(i, i + perMeeting).map((c) => ({
        title: c.topic,
        card: c.card,
        mix: c.mix,
        showMe: `Show me how you handle ${lower(c.topic)}, step by step, in our real system.`,
        why: `Why do you do ${c.steps[0] ? `"${lower(c.steps[0])}"` : "it"} in that order?`,
        couldGoWrong: `What could go wrong with ${lower(c.topic)}, and what would you do if it did?`,
        bestPractices: (c.toPractice.length ? [...c.toPractice, ...c.steps] : c.steps).filter((s, n, a) => a.indexOf(s) === n).slice(0, 4),
      })),
    });
  }
  return meetings.slice(0, MEETINGS);
}


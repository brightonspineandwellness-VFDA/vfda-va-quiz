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
  // Every time it came up in training, oldest first ("W1D2", "W1D2 retake").
  seen: { day: string; ok: boolean }[];
};

// An item tagged with the training day it came from.
export type Dated<T> = T & { day?: string };

// Every skill the VA was quizzed on, once (by workflow and topic): a
// standard not on the cards wins, then still building, then strength.
// Items must be passed oldest first so `seen` stays in training order.
export function candidatesOf(items: { item: Dated<NeedsWorkItem> | Dated<DoneWellItem>; building: boolean }[]): Candidate[] {
  const out = new Map<string, Candidate>();
  const rank: Record<GuideMix, number> = { not_on_cards: 3, building: 2, strength: 1 };
  const add = (i: Dated<NeedsWorkItem> | Dated<DoneWellItem>, building: boolean) => {
    const topic = i.partTitle?.trim() || i.workflowName;
    const key = `${i.workflow}|${topic.toLowerCase()}`;
    const standard = i.ruleSource?.kind === "vfda_standard" || (!i.ruleSource && isVfdaSourceCard(i.sourceCard));
    const mix: GuideMix = standard ? "not_on_cards" : building ? "building" : "strength";
    const card = standard && !i.ruleSource?.card ? "VFDA standard" : i.ruleSource?.card?.trim() || i.sourceCard?.trim() || `${i.workflowName} card`;
    const prev = out.get(key);
    const toPractice = building ? ((i as NeedsWorkItem).missed ?? []) : [];
    const day = i.day?.trim();
    if (prev) {
      if (day) prev.seen.push({ day, ok: !building });
      if (rank[mix] > rank[prev.mix]) prev.mix = mix;
      prev.toPractice = [...new Set([...prev.toPractice, ...toPractice])];
      if (!prev.steps.length) prev.steps = i.correct;
      return;
    }
    out.set(key, {
      key: String(out.size + 1),
      workflowName: i.workflowName,
      topic,
      card,
      mix,
      steps: i.correct.slice(0, 6),
      toPractice,
      seen: day ? [{ day, ok: !building }] : [],
    });
  };
  for (const { item, building } of items) add(item, building);
  return [...out.values()];
}

// "W1D3" -> "Week 1 Day 3" (doctors don't know the codes); "W1D3 retake" too.
export const dayLabel = (d: string) => d.replace(/^W(\d+)D(\d+)/, "Week $1 Day $2");
const list = (raw: string[]) => { const d = raw.map(dayLabel); return d.length > 2 ? `${d.slice(0, -1).join(", ")} and ${d[d.length - 1]}` : d.join(" and "); };

// The skill's training history by day, in order: questions right of asked.
export function byDay(c: Candidate) {
  const out: { day: string; right: number; total: number }[] = [];
  for (const s of c.seen) {
    let d = out.find((x) => x.day === s.day);
    if (!d) out.push((d = { day: s.day, right: 0, total: 0 }));
    d.total++;
    if (s.ok) d.right++;
  }
  return out;
}

// "Why we're testing this": plain words for a doctor who isn't a trainer,
// from the skill's history in training (the prompts say what to look for).
export function whyTest(c: Candidate): string {
  const d = byDay(c);
  const trouble = d.filter((x) => x.right < x.total);
  const lastTrouble = d.map((x) => x.right < x.total).lastIndexOf(true);
  const solidAfter = lastTrouble >= 0 ? d.slice(lastTrouble + 1).filter((x) => x.right === x.total) : [];
  const q = (n: number) => `${n} question${n === 1 ? "" : "s"}`;
  let history = "";
  if (!d.length) history = "";
  else if (!trouble.length) {
    const n = d.reduce((t, x) => t + x.total, 0);
    history = d.length > 1 ? `Got this right every time it came up (${list(d.map((x) => x.day))}). A quick win: let them show off.` : `Got ${n > 1 ? `all ${q(n)}` : "this"} right on ${dayLabel(d[0].day)}. A quick win: let them show off.`;
  } else if (solidAfter.length) {
    history = `Missed this early in training (${list(trouble.map((x) => x.day))}), then got it right (${list(solidAfter.map((x) => x.day))}). Ask again so it's solid.`;
  } else if (trouble.length > 1) {
    history = `Needed help with this on more than one day (${list(trouble.map((x) => x.day))}). Have them walk you through it slowly so it's solid.`;
  } else {
    const t = trouble[0];
    history =
      t.total === 1
        ? `Missed this on ${dayLabel(t.day)} and it hasn't come up since. Ask so it's solid.`
        : t.right
          ? `Got ${t.right} of ${t.total} questions right on ${dayLabel(t.day)}. Ask so the rest is solid too.`
          : `Had trouble with this on ${dayLabel(t.day)} (${q(t.total)}). Ask so it's solid.`;
  }
  if (c.mix === "not_on_cards") {
    const cards =
      c.card === "VFDA standard"
        ? "Not on your Trello cards, so we trained it on the VFDA standard. Check it's how your office does it; if not, show them your way and add it to a card."
        : `Partly not on your "${c.card}" card, so that part was trained on the VFDA standard. Check it's how your office does it; if not, add your way to the card.`;
    return history ? `${history} ${cards}` : cards;
  }
  return history || (c.mix === "building" ? "Still building: ask so it's solid." : "A strength from training: let them show you.");
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
        whyTest: whyTest(c),
        showMe: `Show me how you handle ${lower(c.topic)}, step by step, in our real system.`,
        why: `Why do you do ${c.steps[0] ? `"${lower(c.steps[0])}"` : "it"} in that order?`,
        couldGoWrong: `What could go wrong with ${lower(c.topic)}, and what would you do if it did?`,
        bestPractices: (c.toPractice.length ? [...c.toPractice, ...c.steps] : c.steps).filter((s, n, a) => a.indexOf(s) === n).slice(0, 4),
      })),
    });
  }
  return meetings.slice(0, MEETINGS);
}


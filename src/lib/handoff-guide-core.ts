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
  // A skill they had trouble with but then got right every time since is
  // building no more than it's a strength: keep it "building" so the doctor
  // checks it held, but the reason says it came good.
  return [...out.values()];
}

const days = (d: string[]) => {
  const u = [...new Set(d)];
  return u.length > 2 ? `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}` : u.join(" and ");
};

// "Why we're testing this": plain words for a doctor who isn't a trainer,
// from the skill's history in training.
export function whyTest(c: Candidate): string {
  const missed = c.seen.filter((s) => !s.ok).map((s) => s.day);
  const right = c.seen.filter((s) => s.ok).map((s) => s.day);
  const lastMiss = c.seen.map((s) => s.ok).lastIndexOf(false);
  const fixedLater = lastMiss >= 0 && c.seen.slice(lastMiss + 1).some((s) => s.ok);
  const watch = c.toPractice[0] ? ` Watch for: ${lower(c.toPractice[0]).replace(/\.$/, "")}.` : "";
  let history = "";
  if (missed.length && fixedLater) {
    history = `Missed this early in training (${days(missed)}), then got it right (${days(c.seen.slice(lastMiss + 1).filter((s) => s.ok).map((s) => s.day))}). Ask again so it's solid.`;
  } else if (missed.length > 1) {
    history = `Needed help with this more than once (${days(missed)}). Have them walk you through it slowly so it's solid.${watch}`;
  } else if (missed.length) {
    history = `Missed this in training (${missed[0]}) and it didn't come up again, so it hasn't been re-checked. Ask so it's solid.${watch}`;
  } else if (right.length > 1) {
    history = `Got this right every time it came up (${days(right)}). A quick win: let them show off.`;
  } else if (right.length) {
    history = `Got this right in training (${right[0]}). A quick win: let them show you.`;
  }
  if (c.mix === "not_on_cards") {
    const cards = "This one isn't on your Trello cards, so we trained your VA on the VFDA standard. Make sure it matches how your office does it. If not, show them your way and add it to the card.";
    return history ? `${history} ${cards}` : cards;
  }
  return history || (c.mix === "building" ? `Still building.${watch}` : "A strength from training: let them show you.");
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


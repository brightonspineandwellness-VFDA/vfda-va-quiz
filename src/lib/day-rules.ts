// Per-day topic and item-type rules for building scenarios (settings
// "day_rules", editable there): which cards a day may be written from, which
// item types it may have and which topics it must never touch. Pure, so tests
// can load it. Used when a day is built (the prompt, a topic check on every
// item, the master items a day may use as its pattern) and to recheck days
// already built (src/lib/scenario-actions.ts).

import { nameMatches, NO_CARD_SOURCE } from "@/lib/card-map";
import type { CorrectResponse } from "@/lib/scenario-build";
import { normName } from "@/lib/source-match";

export type ItemType = "mc" | "situational" | "describe";
export const ITEM_TYPES: ItemType[] = ["mc", "situational", "describe"];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  mc: "multiple choice",
  situational: "situational",
  describe: "describe",
};

export type DayRule = {
  // What the day is about, for Claude.
  focus?: string;
  // Only cards with these names (and only master items about them); unset: every card mapped to the day.
  sources?: string[];
  // False: no VFDA standards to fall back on, only the cards.
  standards?: boolean;
  types: ItemType[];
  banned: string[];
};

export type DayRules = {
  // Topic name -> patterns (case-insensitive regular expressions) that mean an item is about it.
  topics: Record<string, string[]>;
  default: DayRule;
  days: Record<string, DayRule>;
  // Where a master item that breaks its own day's rules goes: the first move
  // whose topics it touches and whose day accepts it.
  moves: { topics: string[]; to: string }[];
};

const ALL: ItemType[] = ["mc", "situational", "describe"];
const WRITTEN: ItemType[] = ["mc", "describe"];
const CALL_ADVANCED = ["upset patients", "emergencies", "911", "red flags", "escalating a patient", "complaints", "billing disputes"];
const NOT_PHONE_DAY = ["phone calls", "emergencies", "911", "red flags", "care plans", "report of findings"];

// Also seeded by supabase/migrations/20261103140000_day_rules.sql (kept equal by a test).
export const DEFAULT_DAY_RULES: DayRules = {
  topics: {
    "phone calls": [
      "\\bphone calls?\\b",
      "\\bcall(s|er|ers|ing)?\\b",
      "\\bcalled (you|the office|in|back)\\b",
      "\\bcallbacks?\\b",
      "\\bvoicemails?\\b",
      "\\bon the phone\\b",
      "\\banswer(s|ed|ing)? the phone\\b",
      "\\bphone (script|line)s?\\b",
      "\\b(inbound|outbound) calls?\\b",
    ],
    emergencies: ["\\bemergenc(y|ies)\\b", "\\burgent (symptoms?|care)\\b"],
    "911": ["\\b911\\b"],
    "red flags": [
      "\\bred[- ]flags?\\b",
      "\\bchest pain\\b",
      "\\bnumb(ness)?\\b",
      "\\btingl\\w*",
      "\\b(bladder|bowel) (control|problems?)\\b",
      "\\bcan'?t feel\\b",
    ],
    "escalating a patient": ["\\bescalat\\w*"],
    "care plans": ["\\bcare plans?\\b", "\\btreatment plans?\\b", "\\bplan of care\\b"],
    "report of findings": ["\\breport of findings\\b", "\\bROF\\b"],
    "scheduling cadence": ["\\bcadence\\b", "\\bvisit frequency\\b", "\\b\\w+ (times|visits) (a|per) week\\b"],
    billing: ["\\bbill(s|ed|ing)?\\b", "\\binvoices?\\b", "\\bpayments?\\b", "\\bbalances?\\b", "\\bcharges?\\b", "\\bfees?\\b", "\\bcosts?\\b", "\\bprices?\\b"],
    insurance: ["\\binsurance\\b", "\\binsurers?\\b", "\\bco-?pays?\\b", "\\bdeductibles?\\b", "\\bclaims?\\b", "\\bEOBs?\\b", "\\bcoverage\\b", "\\bmedicare\\b"],
    "upset patients": ["\\bupset\\b", "\\bangry\\b", "\\bfrustrat\\w*", "\\byell\\w*", "\\brude\\b"],
    complaints: ["\\bcomplain\\w*"],
    "billing disputes": ["\\bdisput\\w*", "\\boverchar\\w*", "\\brefunds?\\b", "\\b(wrong|surprise) (bill|charge)s?\\b"],
  },
  default: { types: WRITTEN, banned: NOT_PHONE_DAY },
  days: {
    W1D1: {
      focus: "Basics of chiropractic and VA onboarding: what this office does and why, its mission and values, the VA's role.",
      sources: ["Basics of Chiropractic", "VA Onboarding"],
      standards: false,
      types: WRITTEN,
      banned: [
        "phone calls",
        "emergencies",
        "911",
        "red flags",
        "escalating a patient",
        "care plans",
        "report of findings",
        "scheduling cadence",
        "billing",
        "insurance",
      ],
    },
    W1D2: { focus: "Using the office's EHR, described in the VA's own words.", types: ALL, banned: NOT_PHONE_DAY },
    W1D4: { focus: "Scheduling cadence, care plans and report of findings visits.", types: ALL, banned: ["phone calls", "emergencies", "911", "red flags"] },
    W1D5: {
      focus: "New patient and re-exam checklists, care plans and report of findings visits.",
      types: ALL,
      banned: ["phone calls", "emergencies", "911", "red flags"],
    },
    W2D1: {
      focus: "Basic phone handling: routine inbound and outbound calls, booking, rescheduling, voicemail, common questions.",
      types: ALL,
      banned: [...CALL_ADVANCED, "care plans", "report of findings"],
    },
    W2D2: {
      focus: "Challenging and advanced phone handling: upset patients, emergencies and 911, red flags, escalation, complaints, billing disputes on the phone.",
      types: ALL,
      banned: ["care plans", "report of findings"],
    },
    // Extra cards: situational items for process cards; calls still only on W2D1 / W2D2.
    // Added by supabase/migrations/20261106170000_extra_card_workflows.sql.
    W2D5: {
      focus: "The office's own extra cards: task scenarios from their processes, questions about their information.",
      types: ALL,
      banned: NOT_PHONE_DAY,
    },
  },
  moves: [
    { topics: CALL_ADVANCED, to: "W2D2" },
    { topics: ["phone calls"], to: "W2D1" },
    { topics: ["report of findings"], to: "W1D5" },
    { topics: ["care plans", "scheduling cadence"], to: "W1D4" },
  ],
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

function parseRule(v: unknown): DayRule | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const types = (strings(r.types) ?? []).filter((t): t is ItemType => (ITEM_TYPES as string[]).includes(t));
  if (!types.length) return null;
  return {
    focus: typeof r.focus === "string" ? r.focus : undefined,
    sources: strings(r.sources) ?? undefined,
    standards: r.standards === false ? false : undefined,
    types,
    banned: strings(r.banned) ?? [],
  };
}

// settings.day_rules as stored, or the defaults where it's missing or malformed.
export function parseDayRules(value: unknown): DayRules {
  if (!value || typeof value !== "object") return DEFAULT_DAY_RULES;
  const v = value as Record<string, unknown>;
  const topics: Record<string, string[]> = {};
  if (v.topics && typeof v.topics === "object") {
    for (const [k, p] of Object.entries(v.topics)) {
      const list = (strings(p) ?? []).filter((x) => {
        try {
          new RegExp(x, "i");
          return true;
        } catch {
          return false;
        }
      });
      if (list.length) topics[k] = list;
    }
  }
  const days: Record<string, DayRule> = {};
  if (v.days && typeof v.days === "object") {
    for (const [k, r] of Object.entries(v.days)) {
      const rule = parseRule(r);
      if (rule) days[k] = rule;
    }
  }
  const moves = Array.isArray(v.moves)
    ? v.moves
        .map((m) => m as Record<string, unknown>)
        .filter((m) => m && typeof m.to === "string" && strings(m.topics)?.length)
        .map((m) => ({ topics: strings(m.topics)!, to: m.to as string }))
    : [];
  return {
    topics: Object.keys(topics).length ? topics : DEFAULT_DAY_RULES.topics,
    default: parseRule(v.default) ?? DEFAULT_DAY_RULES.default,
    days,
    moves,
  };
}

export const ruleFor = (rules: DayRules, day: string): DayRule => rules.days[day] ?? rules.default;

// ---------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------

export type RuleItem = { type: ItemType; stem: string };

// What the topic check reads: the question itself, not its options or steps
// (a decoy option or a step may mention a topic in passing) and not
// {PLACEHOLDERS} (an office rule's name is no topic).
export const topicText = (i: { stem: string }) => i.stem.replace(/\{[A-Z0-9_]+\}/g, " ");

// The topics (of those given) an item's text touches, with the words that matched.
export function topicsIn(text: string, rules: DayRules, topics: string[]): { topic: string; words: string }[] {
  const found: { topic: string; words: string }[] = [];
  for (const topic of topics) {
    for (const p of rules.topics[topic] ?? []) {
      let m: RegExpMatchArray | null = null;
      try {
        m = text.match(new RegExp(p, "i"));
      } catch {
        continue;
      }
      if (m) {
        found.push({ topic, words: m[0] });
        break;
      }
    }
  }
  return found;
}

export type RuleFailure = { field: string; value: string; reason: string };

const typesText = (types: ItemType[]) => types.map((t) => ITEM_TYPE_LABELS[t]).join(" and ");

// One day rule an item breaks, or null.
export function checkDayItem(item: RuleItem, day: string, rules: DayRules): RuleFailure | null {
  const rule = ruleFor(rules, day);
  if (!rule.types.includes(item.type)) {
    return { field: "type", value: item.type, reason: `${ITEM_TYPE_LABELS[item.type]} items aren't allowed on ${day}; use ${typesText(rule.types)}` };
  }
  const hit = topicsIn(topicText(item), rules, rule.banned);
  if (hit.length) {
    return {
      field: "topic",
      value: hit.map((h) => h.words).join(", "),
      reason: `${day} must not be about ${hit.map((h) => `${h.topic} ("${h.words}")`).join(", ")}`,
    };
  }
  return null;
}

// The type an item becomes on a day: a situational item is asked as "describe"
// where situational items aren't allowed.
export function typeOnDay(type: ItemType, rule: DayRule): ItemType {
  if (rule.types.includes(type)) return type;
  if (type === "situational" && rule.types.includes("describe")) return "describe";
  if (type === "describe" && rule.types.includes("situational")) return "situational";
  return rule.types.includes("mc") ? "mc" : rule.types[0];
}

// Key points for a describe item: the steps as one plain list.
export const keyPoints = (cr: CorrectResponse | null | undefined): string[] =>
  !cr ? [] : Array.isArray(cr) ? cr : Object.values(cr).flat();

// A card or master item part is one of the day's sources.
export function isSource(name: string, sources: string[] | undefined) {
  if (!sources) return true;
  const n = normName(name);
  return sources.some((s) => {
    const k = normName(s);
    return !!n && !!k && (n.includes(k) || k.includes(n) || nameMatches(s, name));
  });
}

// ---------------------------------------------------------------------------
// The master items a day may use: its own that keep the rules, plus those
// moved in from other days.
// ---------------------------------------------------------------------------

export type PoolMaster = RuleItem & {
  code: string;
  part_title: string;
  type: ItemType;
  correct_response: CorrectResponse | null;
  options: string[] | null;
  answer: string | null;
  critical_fail: string | null;
  points: number;
  answer_format: string | null;
  wants_repeat: boolean;
};

// As the day asks it: situational turned into describe where needed (key
// points, no options, no repeat).
export function asDayType<M extends PoolMaster>(m: M, rule: DayRule): M {
  const type = typeOnDay(m.type, rule);
  if (type === m.type) return m;
  if (type === "describe") {
    return { ...m, type, correct_response: keyPoints(m.correct_response), options: null, answer: null, points: 2, answer_format: null, wants_repeat: false };
  }
  return { ...m, type };
}

export type Move = { code: string; from: string; to: string; topics: string[] };

// Every master item is checked against its own day: kept, moved (first move
// whose topics it touches and whose day accepts it, with a code like
// "W1D1.A6" so it can't clash), or dropped. `slots` keeps the day's own items
// (as the day's types) to hold its item count and type mix; `pool` is what
// the day may use as its pattern.
export function dayPool<M extends PoolMaster>(input: {
  day: string;
  byDay: Map<string, M[]>; // each day's selected master items
  rules: DayRules;
}): { slots: M[]; pool: M[]; moved: Move[]; dropped: { code: string; reason: string }[] } {
  const { day, byDay, rules } = input;
  const keepOn = (m: M, d: string) => {
    const rule = ruleFor(rules, d);
    if (rule.sources && !isSource(m.part_title, rule.sources)) return { ok: false as const, reason: `not about ${rule.sources.join(" or ")}` };
    const failure = checkDayItem(asDayType(m, rule), d, rules);
    return failure ? { ok: false as const, reason: failure.reason } : { ok: true as const };
  };
  const moveOf = (m: M, from: string): string | null => {
    const text = topicText(m);
    for (const mv of rules.moves) {
      if (mv.to === from || !byDay.has(mv.to)) continue;
      if (!topicsIn(text, rules, mv.topics).length) continue;
      if (keepOn(m, mv.to).ok) return mv.to;
    }
    return null;
  };
  const rule = ruleFor(rules, day);
  const own = byDay.get(day) ?? [];
  const pool: M[] = [];
  const dropped: { code: string; reason: string }[] = [];
  const moved: Move[] = [];
  for (const m of own) {
    const k = keepOn(m, day);
    if (k.ok) pool.push(asDayType(m, rule));
    else {
      const to = moveOf(m, day);
      if (to) moved.push({ code: m.code, from: day, to, topics: rules.moves.find((x) => x.to === to)!.topics });
      else dropped.push({ code: m.code, reason: k.reason });
    }
  }
  for (const [from, list] of byDay) {
    if (from === day) continue;
    for (const m of list) {
      if (keepOn(m, from).ok || moveOf(m, from) !== day) continue;
      pool.push(asDayType({ ...m, code: `${from}.${m.code}` }, rule));
    }
  }
  return { slots: own.map((m) => asDayType(m, rule)), pool, moved, dropped };
}

// The day's rules as Claude reads them.
export function rulesPrompt(day: string, rules: DayRules, cardTitles: string[]): string {
  const rule = ruleFor(rules, day);
  const lines = [`Rules for ${day} (every item must keep them):`];
  if (rule.focus) lines.push(`- About: ${rule.focus}`);
  if (rule.sources) {
    lines.push(`- Write ONLY from the text of these cards: ${cardTitles.length ? cardTitles.join("; ") : rule.sources.join("; ")}.${rule.standards === false ? " No VFDA standards, nothing else." : ""}`);
  }
  lines.push(`- Item types allowed: ${typesText(rule.types)}.${rule.types.includes("situational") ? "" : " NO situational items."}`);
  if (rule.banned.length) lines.push(`- Never about: ${rule.banned.join(", ")}. No item may be set in or ask about these.`);
  if (rule.types.includes("describe")) {
    lines.push(
      `- A "describe" item is a short question the VA answers in their own words (e.g. "In your own words, what does this office do differently from other chiropractors?"). Its correct_response is the key points a good answer covers, taken from the card (one list, box null). No options, no answer letter, no critical_fail, escalation_level "none".`,
    );
  }
  return lines.join("\n");
}

// A built item (rechecked when the day rules change or VFDA edits it): the day
// rules, plus where it came from (its card, or the master part it follows).
export function checkBuiltItem(
  item: RuleItem & { source_card: string | null; part_title: string },
  day: string,
  rules: DayRules,
): RuleFailure | null {
  const broken = checkDayItem(item, day, rules);
  if (broken) return broken;
  const rule = ruleFor(rules, day);
  const from = item.source_card || item.part_title;
  // The office has no card for this topic: VFDA's master bank stands in.
  if (item.source_card === NO_CARD_SOURCE) return null;
  if (rule.sources && !isSource(from, rule.sources)) {
    return { field: "source_card", value: from, reason: `${day} is written only from ${rule.sources.join(" and ")}` };
  }
  return null;
}

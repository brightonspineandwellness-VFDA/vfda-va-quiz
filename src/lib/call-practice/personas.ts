import "server-only";

// The made-up patient for one call, and the plan of what they'll bring up.
// Everything here is fictional: names from a fixed list, 555-01xx phone
// numbers (reserved for fiction), and no real addresses.

import { createAdminClient } from "@/lib/supabase/server";
import type { CallContext, CadenceRule } from "./rules";
import type { CallType, Roleplay } from "./types";

type Db = ReturnType<typeof createAdminClient>;

export type Persona = {
  firstName: string;
  lastName: string;
  age: number;
  phone: string; // fictional 555-01xx
  voice: string; // OpenAI TTS voice
  reason: string; // why they're calling
  referral: string;
  insurance: string;
  style: string; // how they talk
  asks: string[]; // what they'll bring up, in order (hidden test plan)
  roleplay?: { title: string; brief: string; scenario?: string };
};

const FIRST = [
  ["Sarah", "nova"], ["Mike", "onyx"], ["Linda", "shimmer"], ["James", "echo"], ["Maria", "nova"],
  ["David", "onyx"], ["Karen", "shimmer"], ["Robert", "echo"], ["Jessica", "nova"], ["Tom", "fable"],
  ["Angela", "shimmer"], ["Chris", "echo"], ["Denise", "nova"], ["Paul", "onyx"], ["Rachel", "shimmer"],
] as const;
const LAST = ["Johnson", "Davis", "Miller", "Garcia", "Wilson", "Thompson", "Martinez", "Clark", "Lewis", "Walker", "Hall", "Young"];
const REASONS = [
  "lower back pain for about two weeks after lifting boxes",
  "neck pain and stiffness, worse at the computer",
  "headaches that start in the neck",
  "sciatica down the left leg",
  "mid-back pain since a fender bender last month",
  "shoulder and upper back tightness",
];
const REFERRALS = ["a friend recommended you", "found you on Google", "saw your sign driving by", "my coworker goes there", "a Facebook ad"];
const INSURANCE = ["Blue Cross Blue Shield", "Aetna", "UnitedHealthcare", "Cigna", "no insurance, paying myself"];

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
const shuffle = <T,>(list: readonly T[]) => [...list].sort(() => Math.random() - 0.5);

// Challenging-call pressure points, carried over from Call Trainer 2.0.
const CHALLENGING_ASKS = [
  "Ask how much the first visit costs, and push back if it sounds expensive.",
  "Ask whether your insurance covers it, then ask again more firmly (\"doesn't my insurance cover anything?\").",
  "Say you're very busy and ask how long the appointment takes.",
  "Hesitate and say you might call back another time; only book if the VA gives you a good reason.",
  "Ask what you need to bring.",
];

// A cadence rule turned into something the caller does. "defer" rules (care
// plan) are never pushed; the patient only mentions it lightly if at all.
function cadenceAsk(rule: CadenceRule): string | null {
  if (rule.callUse === "defer") return null;
  const tests: Record<string, string> = {
    PROTECTED_BLOCKS: "Ask for an appointment time that falls in one of these blocked times",
    SAME_DAY_CUTOFF: "Ask to be seen today, late in the day",
    SCHEDULE_MATRIX: "Ask for a time or visit length that doesn't fit the visit type",
    PROVIDER_RULES: "Ask to see a provider who doesn't handle your visit type",
    ROF_RULE: "After booking, ask when you'd come back to hear the results, and suggest a day that's too late",
    LATE_CANCEL_RULE: "Mention you may need to cancel the morning of, and ask if that's a problem",
    CONFIRM_RULE: "Ask whether someone will remind you before the visit",
    NO_SHOW_RULE: "Mention you missed an appointment somewhere else last week and ask what happens if you miss one here",
  };
  const how = tests[rule.key];
  return how ? `${how}. (Office rule being tested, never quote it: ${rule.label}: ${rule.value})` : null;
}

const ROLEPLAY_BRIEFS: Record<Roleplay, string> = {
  new_patient: "You're a new patient calling to book your first appointment. Cooperative. Let the VA lead and ask the questions.",
  existing_patient:
    "You're an existing patient. You want to move your next appointment, or you have a question about your account balance. Give your name; see if the VA verifies who you are before sharing details.",
  confirmation:
    "The VA is calling YOU to confirm tomorrow's appointment. Answer the phone (\"Hello?\"), confirm, and ask one practical question (what time again, or where to park).",
  financial_objection:
    "You want care but the cost worries you. Say it's too expensive, ask about discounts, and say you might shop around. Only book if the VA handles it well.",
  upset_scheduling:
    "You're upset: your appointment was moved or you waited on hold. Be frustrated but not abusive. Calm down if the VA listens and offers options.",
  safety_privacy:
    "Mention a symptom that should be escalated (numbness spreading down both legs, or trouble controlling your bladder), or ask for another patient's appointment details. See whether the VA escalates or protects privacy.",
};

// Roleplay keyword hints to find a matching office scenario for that day.
const ROLEPLAY_HINTS: Record<Roleplay, RegExp> = {
  new_patient: /new patient|first (visit|appointment)/i,
  existing_patient: /existing|reschedul|balance|account/i,
  confirmation: /confirm/i,
  financial_objection: /cost|price|afford|expensive|discount|money/i,
  upset_scheduling: /upset|angry|frustrat|waited|hold/i,
  safety_privacy: /red.?flag|emergenc|numb|privacy|HIPAA|another patient|escalat/i,
};

// One stem from the office's approved (live) W2D1 / W2D2 scenarios that fits
// the roleplay. Only the situation is used to brief the patient; answer keys
// stay on the server and are used only by the grader.
export async function roleplayScenario(db: Db, officeId: string, roleplay: Roleplay) {
  const day = (["new_patient", "existing_patient", "confirmation"] as Roleplay[]).includes(roleplay) ? "W2D1" : "W2D2";
  const live = (await db.from("office_days").select("live_version").eq("office_id", officeId).eq("schedule_day", day).maybeSingle())
    .data as { live_version: number | null } | null;
  if (!live?.live_version) return null;
  const rows = ((
    await db
      .from("office_scenarios")
      .select("code, stem, correct_response, critical_fail")
      .eq("office_id", officeId)
      .eq("schedule_day", day)
      .eq("build_version", live.live_version)
      .eq("type", "situational")
      .eq("is_repeat_variant", false)
  ).data ?? []) as { code: string; stem: string; correct_response: unknown; critical_fail: string | null }[];
  const matches = rows.filter((r) => ROLEPLAY_HINTS[roleplay].test(r.stem));
  return matches.length ? pick(matches) : null;
}

export function makePersona(input: {
  callType: CallType;
  roleplay: Roleplay | null;
  ctx: CallContext;
  scenarioStem?: string | null;
}): Persona {
  const [firstName, voice] = pick(FIRST);
  const testable = shuffle(input.ctx.cadence.map(cadenceAsk).filter((a): a is string => !!a));
  let asks: string[];
  let style: string;
  if (input.callType === "easy" || input.callType === "w2d1_roleplay") {
    style = "Friendly and cooperative. Answers questions, easy to book.";
    asks = testable.slice(0, 1);
  } else {
    style = "Busy and a little skeptical. Raises objections about time, money or commitment, and pushes on scheduling.";
    asks = [...shuffle(CHALLENGING_ASKS).slice(0, 2), ...testable.slice(0, 2)];
  }
  const persona: Persona = {
    firstName,
    lastName: pick(LAST),
    age: 28 + Math.floor(Math.random() * 40),
    phone: `555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`,
    voice,
    reason: pick(REASONS),
    referral: pick(REFERRALS),
    insurance: pick(INSURANCE),
    style,
    asks,
  };
  if (input.roleplay) {
    persona.roleplay = {
      title: input.roleplay,
      brief: ROLEPLAY_BRIEFS[input.roleplay],
      scenario: input.scenarioStem ?? undefined,
    };
  }
  return persona;
}

// Patient turn limits: easy about 8 turns, challenging about 14.
export const turnLimit = (t: CallType) => (t === "easy" || t === "w2d1_roleplay" ? 10 : 16);
export const targetTurns = (t: CallType) => (t === "easy" || t === "w2d1_roleplay" ? 8 : 14);

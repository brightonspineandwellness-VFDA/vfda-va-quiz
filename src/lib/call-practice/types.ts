// Shared shapes for Call practice. No server-only import: the call screen uses these too.

export const CALL_TYPES = ["easy", "challenging", "w2d1_roleplay", "w2d2_roleplay"] as const;
export type CallType = (typeof CALL_TYPES)[number];

export const ROLEPLAYS = {
  w2d1_roleplay: ["new_patient", "existing_patient", "confirmation"],
  w2d2_roleplay: ["financial_objection", "upset_scheduling", "safety_privacy"],
} as const;
export type Roleplay = (typeof ROLEPLAYS)[keyof typeof ROLEPLAYS][number];

export const ROLEPLAY_TITLES: Record<Roleplay, string> = {
  new_patient: "New patient, first appointment",
  existing_patient: "Existing patient, routine scheduling or account question",
  confirmation: "Appointment confirmation",
  financial_objection: "Financial objection",
  upset_scheduling: "Upset scheduling patient",
  safety_privacy: "Safety, privacy and escalation",
};

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  easy: "Easy call",
  challenging: "Challenging call",
  w2d1_roleplay: "W2D1 roleplay",
  w2d2_roleplay: "W2D2 roleplay",
};

// Counts toward the 25 easy / 25 challenging goal.
export const goalBucket = (t: CallType): "easy" | "challenging" =>
  t === "easy" || t === "w2d1_roleplay" ? "easy" : "challenging";

export type Speaker = "va" | "patient";
export type TranscriptEntry = { speaker: Speaker; text: string; at: string };

export type CadenceSource = "office" | "vfda_standard";

// What the browser gets about the patient: no hidden test notes.
export type PublicPersona = { firstName: string; voice: string };

export const isRoleplayFor = (t: CallType, r: string | null | undefined): r is Roleplay =>
  t === "w2d1_roleplay" || t === "w2d2_roleplay" ? (ROLEPLAYS[t] as readonly string[]).includes(r ?? "") : false;

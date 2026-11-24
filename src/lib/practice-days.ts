// Practice days: every VA gets 10 quiz days. When W2D3 (Insurance), W2D4
// (Billing) or W2D5 (Extra cards) is skipped for the office (its condition
// is false) or left out of the VA's role, the VA gets a practice day in the
// same slot instead. Pure functions, so pages, the server and tests share them.
//
// - Office skips the day: the office's own day code (W2D3 ...) is built as
//   the phone practice day (office_days.kind "skipped").
// - The office has the day but the VA's role leaves it out: W2P3 / W2P4,
//   the same phone practice days (W2D5 is in every role).
// - The VA's role has no Phones: W2W3 / W2W4 / W2W5, a practice day on the
//   weakest workflow of the VA's role (named after it), built at the office
//   from the VAs who need it.
//
// W2P* and W2W* are rows of schedule_days (supabase/migrations/
// 20261124130000_practice_days.sql) but not in settings.sequence: they only
// stand in for a slot.

export const PRACTICE_SLOTS = ["W2D3", "W2D4", "W2D5"] as const;
export type PracticeSlot = (typeof PRACTICE_SLOTS)[number];

export type PhoneMode = "everyday" | "tricky" | "mixed";

export const PHONE_PRACTICE: Record<PracticeSlot, { n: number; mode: PhoneMode; title: string; focus: string }> = {
  W2D3: {
    n: 1,
    mode: "everyday",
    title: "Phone practice 1: Everyday calls",
    focus: "Everyday calls: booking, rescheduling, cancellations, confirmations, voicemail and FAQs.",
  },
  W2D4: {
    n: 2,
    mode: "tricky",
    title: "Phone practice 2: Tricky calls",
    focus:
      "Tricky calls: upset or confused patients, price and coverage questions, care plan questions, and situations that need the doctor's approval.",
  },
  W2D5: {
    n: 3,
    mode: "mixed",
    title: "Phone practice 3: Mixed review",
    focus: "A mixed review: everyday and tricky calls, plus emergencies and red flags and when and how to escalate.",
  },
};

// The role-based stand-ins.
export const phoneCode = (slot: PracticeSlot) => slot.replace("D", "P"); // W2P3
export const workflowCode = (slot: PracticeSlot) => slot.replace("D", "W"); // W2W3

export const isPracticeCode = (code: string) => /^W2[PW][345]$/.test(code);
export const isPhonePracticeCode = (code: string) => /^W2P[345]$/.test(code);
export const isWorkflowPracticeCode = (code: string) => /^W2W[345]$/.test(code);

// The slot a practice code (or a slot code) stands for.
export function slotOf(code: string): PracticeSlot | null {
  const slot = code.replace(/^W2[PW]/, "W2D");
  return (PRACTICE_SLOTS as readonly string[]).includes(slot) ? (slot as PracticeSlot) : null;
}

// 1st, 2nd or 3rd weakest workflow for W2W3, W2W4, W2W5.
export const workflowRank = (code: string) => (slotOf(code) ? PHONE_PRACTICE[slotOf(code)!].n - 1 : 0);

export const WORKFLOW_PRACTICE_TITLE = (name: string) => `Practice: ${name}`;

// The title a VA, VFDA and the doctors see for a day at an office: the
// office's own (a practice day's, set when it's built), else the phone
// practice title when the office skips the slot, else the day's.
export function officeDayTitle(code: string, scheduleTitle: string, officeDay?: { kind?: string | null; title?: string | null } | null): string {
  if (officeDay?.title) return officeDay.title;
  const slot = slotOf(code);
  if (slot && (officeDay?.kind === "skipped" || isPhonePracticeCode(code))) return PHONE_PRACTICE[slot].title;
  return scheduleTitle;
}

// What stands in a slot for one VA: the day itself, or its practice day.
// `officeHas`: the day's condition holds for the office. `inScope`: the
// VA's role includes it. `phones`: the VA's role includes Phones.
export function slotDay(slot: PracticeSlot, input: { officeHas: boolean; inScope: boolean; phones: boolean }): string {
  if (input.officeHas && input.inScope) return slot;
  if (!input.phones) return workflowCode(slot);
  return input.officeHas ? phoneCode(slot) : slot;
}

// Practice days take their release no earlier than this office date (the
// day after they were added), so VAs whose schedule had already run out
// get them one per weekday from then on, never Late for past dates.
export const PRACTICE_RELEASE_FROM = "2026-11-25";

// ---------------------------------------------------------------------------
// The weakest workflow (W2W* days): the lowest first-try share of points.
// ---------------------------------------------------------------------------

export type WorkflowScore = { workflow: string; points: number; max: number };

// Workflows in the VA's role, weakest first. Workflows with no answers yet
// come after those with answers, in the given order.
export function weakestWorkflows(roleWorkflows: string[], scores: WorkflowScore[]): string[] {
  const share = new Map<string, { points: number; max: number }>();
  for (const s of scores) {
    const t = share.get(s.workflow) ?? { points: 0, max: 0 };
    t.points += s.points;
    t.max += s.max;
    share.set(s.workflow, t);
  }
  const ratio = (w: string) => {
    const t = share.get(w);
    return t && t.max > 0 ? t.points / t.max : Number.POSITIVE_INFINITY;
  };
  return roleWorkflows
    .map((w, i) => ({ w, i }))
    .sort((a, b) => ratio(a.w) - ratio(b.w) || a.i - b.i)
    .map((x) => x.w);
}

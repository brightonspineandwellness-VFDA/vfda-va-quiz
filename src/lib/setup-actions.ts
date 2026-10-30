"use server";

// The doctor's confirmations and answers in steps 4-6. Each action re-reads
// the office's flow on the server, refuses while those steps are locked
// (until VFDA sends the reviewed rules), and only touches the rows the flow
// shows, writing as the doctor (row-level security and the database guards
// apply).

import { getCurrentUser } from "@/lib/auth";
import { checkAnswerValue } from "@/lib/interview";
import type { ActionResult } from "@/lib/interview-actions";
import { loadOfficeSetup } from "@/lib/interview-data";
import { createSessionClient } from "@/lib/supabase/server";

const fail = (error: string) => ({ ok: false, error }) as const;
const LOCKED = "This step opens after VFDA reviews your cards.";

// The signed-in doctor's office flow, only once steps 4-6 are open.
async function doctorFlow() {
  const user = await getCurrentUser();
  if (user?.role !== "doctor" || !user.officeId) return null;
  const setup = await loadOfficeSetup(user.officeId);
  return setup ? { officeId: user.officeId, flow: setup.flow } : null;
}
type Ctx = NonNullable<Awaited<ReturnType<typeof doctorFlow>>>;

async function accept(ids: string[]): Promise<ActionResult> {
  if (ids.length === 0) return { ok: true, data: null };
  const supabase = await createSessionClient();
  // The guard keeps each rule's value and source, and stamps the doctor's approval.
  const { error } = await supabase.from("office_rules").update({ status: "accepted" }).in("id", ids);
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

// "Looks right": accepts every rule shown on one card group screen.
export async function confirmCardGroup(slug: string): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can confirm rules.");
  if (!ctx.flow.unlocked) return fail(LOCKED);
  const group = ctx.flow.groups.find((g) => g.slug === slug);
  if (!group) return fail("Unknown card group.");
  return accept(group.items.flatMap((i) => (i.kind === "card" && !i.confirmed ? i.confirmIds : [])));
}

// "Accept all": every VFDA standard without a pending card version.
export async function acceptAllStandards(): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can accept standards.");
  if (!ctx.flow.unlocked) return fail(LOCKED);
  return accept(ctx.flow.standards.flatMap((s) => (!s.accepted && !s.override && s.row ? [s.row.id] : [])));
}

function findOverride(flow: Ctx["flow"], cardRuleId: string) {
  if (!flow.unlocked) return undefined;
  return flow.standards.find((s) => s.override?.id === cardRuleId);
}

// The card says something different from the VFDA standard: use the card's version.
export async function useCardVersion(cardRuleId: string): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can choose.");
  const item = findOverride(ctx.flow, cardRuleId);
  if (!item?.override) return fail("That card version is no longer waiting.");
  const supabase = await createSessionClient();
  const { error } = await supabase.from("office_rules").upsert(
    {
      office_id: ctx.officeId,
      rule_slot_key: item.slot.key,
      source_document_id: null,
      rule: item.override.rule,
      source: "doctor",
      status: "accepted",
    },
    { onConflict: "office_id,rule_slot_key,source_document_id" },
  );
  if (error) return fail("Couldn't save. Try again.");
  return accept([cardRuleId]);
}

// ...or keep the VFDA standard and turn the card's version down.
export async function keepStandard(cardRuleId: string): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can choose.");
  const item = findOverride(ctx.flow, cardRuleId);
  if (!item?.override) return fail("That card version is no longer waiting.");
  const supabase = await createSessionClient();
  const { error } = await supabase.from("office_rules").update({ status: "rejected" }).eq("id", cardRuleId);
  if (error) return fail("Couldn't save. Try again.");
  return accept(item.row ? [item.row.id] : []);
}

// "Questions for you": the doctor's answer to one gap question. For a rule
// slot it also becomes the office's accepted rule (source doctor).
export async function answerGapQuestion(gapId: string, value: unknown): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can answer.");
  if (!ctx.flow.unlocked) return fail(LOCKED);
  const item = ctx.flow.questions.find((q) => q.gap.id === gapId);
  if (!item) return fail("That question isn't open any more.");
  const supabase = await createSessionClient();

  if (item.slot) {
    const problem = checkAnswerValue(item.slot, value);
    if (problem) return fail(problem);
    const { error } = await supabase.from("office_rules").upsert(
      {
        office_id: ctx.officeId,
        rule_slot_key: item.slot.key,
        source_document_id: null,
        rule: value,
        source: "doctor",
        status: "accepted",
      },
      { onConflict: "office_id,rule_slot_key,source_document_id" },
    );
    if (error) return fail("Couldn't save. Try again.");
  } else if (typeof value !== "string" || !value.trim()) {
    return fail("Type your answer first.");
  } else if (value.length > 5000) {
    return fail("That answer is too long.");
  }

  // The guard stamps who answered and when.
  const { error } = await supabase.from("gap_questions").update({ answer: value }).eq("id", gapId);
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

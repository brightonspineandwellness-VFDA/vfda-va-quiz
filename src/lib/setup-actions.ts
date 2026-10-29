"use server";

// The doctor's confirmations in steps 2 and 3. Each action re-reads the
// office's flow on the server and only touches the rows it shows, writing as
// the doctor (row-level security and the office_rules guard apply).

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { loadOfficeSetup } from "@/lib/interview-data";
import { createSessionClient } from "@/lib/supabase/server";

const fail = (error: string) => ({ ok: false, error }) as const;

async function doctorFlow() {
  const user = await getCurrentUser();
  if (user?.role !== "doctor" || !user.officeId) return null;
  const setup = await loadOfficeSetup(user.officeId);
  return setup ? { officeId: user.officeId, flow: setup.flow } : null;
}

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
  const group = ctx.flow.groups.find((g) => g.slug === slug);
  if (!group) return fail("Unknown card group.");
  return accept(group.items.flatMap((i) => (i.kind === "rule" && !i.confirmed ? i.confirmIds : [])));
}

// "Accept all": every VFDA standard without a pending card version.
export async function acceptAllStandards(): Promise<ActionResult> {
  const ctx = await doctorFlow();
  if (!ctx) return fail("Only the office's doctor can accept standards.");
  return accept(ctx.flow.standards.flatMap((s) => (!s.accepted && !s.override && s.row ? [s.row.id] : [])));
}

function findOverride(flow: NonNullable<Awaited<ReturnType<typeof doctorFlow>>>["flow"], cardRuleId: string) {
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

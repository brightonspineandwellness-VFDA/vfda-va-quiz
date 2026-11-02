"use server";

// VFDA's card mapping (/admin/offices/[id]/rules): which training day(s) and
// workflow each card PDF feeds, or "skip" for a card with no process content.
// VFDA admins only; writes as the admin (row-level security applies).

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;

export type CardMapping = { days: string[]; workflow: string | null; skip: boolean };

export async function updateCardMapping(documentId: string, mapping: CardMapping): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return fail("VFDA admins only.");
  if (!UUID.test(documentId) || !Array.isArray(mapping.days)) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const { data: doc } = await supabase.from("office_documents").select("office_id, imported_at").eq("id", documentId).maybeSingle();
  if (!doc) return fail("That card is gone.");
  if (!doc.imported_at) return fail("This card hasn't been read yet.");

  const [{ data: days }, { data: workflows }, { data: gray }] = await Promise.all([
    supabase.from("schedule_days").select("code"),
    supabase.from("workflows").select("code"),
    supabase.from("office_workflows").select("code").eq("office_id", doc.office_id),
  ]);
  const dayCodes = new Set((days ?? []).map((d) => d.code));
  const chosen = [...new Set(mapping.days)].filter((d) => dayCodes.has(d)).sort();
  if (chosen.length !== new Set(mapping.days).size) return fail("Unknown training day.");
  const workflowCodes = new Set([...(workflows ?? []), ...(gray ?? [])].map((w) => w.code));
  if (mapping.workflow !== null && !workflowCodes.has(mapping.workflow)) return fail("Unknown workflow.");
  if (!mapping.skip && chosen.length === 0) return fail("Pick at least one day, or mark the card skip.");

  const { error } = await supabase
    .from("office_documents")
    .update({
      schedule_days: chosen,
      workflow: mapping.workflow,
      skip: !!mapping.skip,
      mapped_by: user.id,
      mapped_at: new Date().toISOString(),
    })
    .eq("id", documentId);
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

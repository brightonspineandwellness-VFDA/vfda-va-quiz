"use server";

// VFDA's review of the office's extra card workflows (Cards & rules page):
// edit, approve (scenarios are built only from approved ones), un-approve,
// read the card again. VFDA admins only.

import { getCurrentUser } from "@/lib/auth";
import { reextractExtraWorkflow } from "@/lib/extra-workflows";
import type { ActionResult } from "@/lib/interview-actions";
import { createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

export type ExtraWorkflowEdit = {
  name: string;
  kind: "process" | "info";
  phone: "none" | "routine" | "advanced";
  trigger: string;
  steps: string[];
  definition_of_done: string;
  va_can_decide: string[];
  requires_approval: string[];
  immediate_escalation: string[];
};

const lines = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((x) => x.slice(0, 500));

// Saves VFDA's edits and approves the workflow.
export async function saveExtraWorkflow(workflowId: string, edit: ExtraWorkflowEdit): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(workflowId) || !edit) return fail("Invalid request.");
  const name = String(edit.name ?? "").trim();
  if (!name || name.length > 200) return fail("Give the workflow a name.");
  if (!["process", "info"].includes(edit.kind) || !["none", "routine", "advanced"].includes(edit.phone)) return fail("Invalid request.");
  const steps = lines(edit.steps);
  if (edit.kind === "process" && !steps.length) return fail('A process needs its steps (one per line), or mark it "info only".');
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("office_workflows")
    .update({
      name,
      kind: edit.kind,
      phone: edit.kind === "process" ? edit.phone : "none",
      trigger: String(edit.trigger ?? "").trim().slice(0, 1000),
      steps: edit.kind === "process" ? steps : [],
      definition_of_done: String(edit.definition_of_done ?? "").trim().slice(0, 1000),
      va_can_decide: lines(edit.va_can_decide),
      requires_approval: lines(edit.requires_approval),
      immediate_escalation: lines(edit.immediate_escalation),
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    })
    .eq("id", workflowId)
    .not("source_document_id", "is", null)
    .select("id");
  return error || !data?.length ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

export async function setExtraWorkflowApproved(workflowId: string, approved: boolean): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(workflowId)) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("office_workflows")
    .update(approved ? { approved_at: new Date().toISOString(), approved_by: user.id } : { approved_at: null, approved_by: null })
    .eq("id", workflowId)
    .not("source_document_id", "is", null)
    .select("id");
  return error || !data?.length ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

export async function reextractExtraWorkflowAction(workflowId: string): Promise<ActionResult> {
  if (!(await admin())) return fail("VFDA admins only.");
  if (!UUID.test(workflowId)) return fail("Invalid request.");
  try {
    const error = await reextractExtraWorkflow(workflowId);
    return error ? fail(error) : { ok: true, data: null };
  } catch (e) {
    return fail(`Couldn't read the card: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
}

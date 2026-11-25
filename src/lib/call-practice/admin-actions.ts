"use server";

// VFDA's controls for Call practice (/admin/calls): override a call's result
// with a note, the global settings (on/off, daily cap, all offices, Phones
// role only) and which offices have it. VFDA admins only; writes as the admin
// (row-level security applies). Never touches quiz tables.

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { syncRoleplayProof } from "./proof";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

// result null = remove the override (the call's own result applies again).
export async function overrideCall(id: string, result: "passed" | "practice_again" | null, note: string): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(id) || (result !== null && result !== "passed" && result !== "practice_again")) return fail("Invalid request.");
  const text = note.trim().slice(0, 1000);
  if (result && !text) return fail("Add a note saying why.");
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("practice_calls")
    .update(
      result
        ? { override_result: result, override_note: text, overridden_by: user.id, overridden_at: new Date().toISOString() }
        : { override_result: null, override_note: null, overridden_by: null, overridden_at: null },
    )
    .eq("id", id)
    .eq("status", "finished")
    .select("id, va_id, office_id, roleplay");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Only finished calls can be overridden.");
  // An override to Passed can complete a day's three roleplays.
  const row = data[0] as { va_id: string; office_id: string; roleplay: string | null };
  if (row.roleplay && result === "passed") {
    await syncRoleplayProof(createAdminClient(), row.va_id, row.office_id).catch((e: unknown) => console.error("Roleplay proof sync failed:", e));
  }
  return { ok: true, data: null };
}

export async function saveCallSettings(input: {
  enabled: boolean;
  dailyCap: number;
  allOffices: boolean;
  requirePhonesRole: boolean;
}): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  const cap = Math.round(Number(input.dailyCap));
  if (!Number.isFinite(cap) || cap < 1 || cap > 100) return fail("The daily cap must be between 1 and 100.");
  const supabase = await createSessionClient();
  const { error } = await supabase
    .from("call_practice_settings")
    .upsert({
      id: true,
      enabled: !!input.enabled,
      daily_cap: cap,
      all_offices: !!input.allOffices,
      require_phones_role: !!input.requirePhonesRole,
      updated_by: user.id,
    });
  return error ? fail(error.message) : { ok: true, data: null };
}

export async function setCallPracticeOffice(officeId: string, on: boolean): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(officeId)) return fail("Invalid request.");
  const supabase = await createSessionClient();
  const { error } = on
    ? await supabase.from("call_practice_offices").upsert({ office_id: officeId, enabled_by: user.id })
    : await supabase.from("call_practice_offices").delete().eq("office_id", officeId);
  return error ? fail(error.message) : { ok: true, data: null };
}

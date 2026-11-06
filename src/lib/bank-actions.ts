"use server";

// "Share answer bank with doctor" on the office's scenario bank. VFDA admins only.

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setShareAnswerBank(officeId: string, share: boolean): Promise<ActionResult> {
  if ((await getCurrentUser())?.role !== "vfda_admin") return { ok: false, error: "VFDA admins only." };
  if (!UUID.test(officeId)) return { ok: false, error: "Invalid request." };
  const { data, error } = await (await createSessionClient()).from("offices").update({ share_answer_bank: share }).eq("id", officeId).select("id");
  return error || !data?.length ? { ok: false, error: "Couldn't save. Try again." } : { ok: true, data: null };
}

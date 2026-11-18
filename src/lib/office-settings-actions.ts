"use server";

// VFDA's office settings: the office's time zone (offices.time_zone), which
// decides its Sunday-night sends (src/lib/week.ts).

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { createAdminClient } from "@/lib/supabase/server";
import { TIME_ZONES } from "@/lib/week";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setOfficeTimeZone(officeId: string, timeZone: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return { ok: false, error: "VFDA admins only." };
  if (!UUID.test(officeId) || !TIME_ZONES.some((z) => z.value === timeZone)) return { ok: false, error: "Invalid request." };
  const { error } = await createAdminClient().from("offices").update({ time_zone: timeZone }).eq("id", officeId);
  if (error) return { ok: false, error: /time_zone/.test(error.message) ? "Run supabase/weekly-summary.sql first." : "Couldn't save. Try again." };
  revalidatePath(`/admin/offices/${officeId}`);
  return { ok: true, data: null };
}

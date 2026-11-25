import "server-only";

// Who may use Call practice, and how many calls they have left today.
// Settings live in call_practice_settings (one row) and call_practice_offices
// (supabase/migrations/20261126120000_call_practice.sql):
//   enabled = false              -> off for everyone (global switch)
//   all_offices = false          -> only offices in call_practice_offices (pilot)
//   require_phones_role = true   -> only VAs whose role includes Phones
// Read with the service role on the server; never trusted from the browser.

import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { todayIn } from "@/lib/va-flow";
import { normalizeScope } from "@/lib/va-scope";
import { localDate, zoneOf } from "@/lib/week";

type Db = ReturnType<typeof createAdminClient>;

export type CallPracticeSettings = {
  enabled: boolean;
  dailyCap: number;
  allOffices: boolean;
  requirePhonesRole: boolean;
};

const DEFAULT_SETTINGS: CallPracticeSettings = { enabled: false, dailyCap: 15, allOffices: false, requirePhonesRole: false };

export type CallAccess =
  | { allowed: true; settings: CallPracticeSettings; officeId: string; timeZone: string }
  | { allowed: false; reason: "off" | "not_va" | "no_office" | "office_not_enabled" | "no_phones_role" };

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// Missing row or table (migration not run yet) = off.
export async function loadCallSettings(db: Db = createAdminClient()): Promise<CallPracticeSettings> {
  const { data, error } = await db
    .from("call_practice_settings")
    .select("enabled, daily_cap, all_offices, require_phones_role")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  return {
    enabled: data.enabled,
    dailyCap: data.daily_cap,
    allOffices: data.all_offices,
    requirePhonesRole: data.require_phones_role,
  };
}

export async function officeHasCallPractice(officeId: string, settings: CallPracticeSettings, db: Db = createAdminClient()) {
  if (!settings.enabled) return false;
  if (settings.allOffices) return true;
  const row = must(await db.from("call_practice_offices").select("office_id").eq("office_id", officeId).maybeSingle());
  return !!row;
}

export async function callAccess(user: CurrentUser, db: Db = createAdminClient()): Promise<CallAccess> {
  const settings = await loadCallSettings(db);
  if (!settings.enabled) return { allowed: false, reason: "off" };
  if (user.role !== "va") return { allowed: false, reason: "not_va" };
  if (!user.officeId) return { allowed: false, reason: "no_office" };
  if (!(await officeHasCallPractice(user.officeId, settings, db))) return { allowed: false, reason: "office_not_enabled" };

  const [profile, office] = await Promise.all([
    db.from("profiles").select("va_scope").eq("id", user.id).maybeSingle(),
    db.from("offices").select("time_zone").eq("id", user.officeId).maybeSingle(),
  ]);
  if (settings.requirePhonesRole && !normalizeScope(must(profile)?.va_scope).includes("phones")) {
    return { allowed: false, reason: "no_phones_role" };
  }
  return { allowed: true, settings, officeId: user.officeId, timeZone: zoneOf(must(office)?.time_zone) };
}

// Calls started today (office time). Every started call counts toward the cap,
// so abandoning a call doesn't give a free retry.
export async function callsStartedToday(vaId: string, timeZone: string, db: Db = createAdminClient(), now = new Date()) {
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const rows = must(await db.from("practice_calls").select("started_at").eq("va_id", vaId).gte("started_at", since)) as {
    started_at: string;
  }[];
  const today = todayIn(timeZone, now);
  return rows.filter((r) => localDate(timeZone, r.started_at) === today).length;
}

export const ACCESS_MESSAGES: Record<Exclude<CallAccess, { allowed: true }>["reason"], string> = {
  off: "Call practice is turned off right now.",
  not_va: "Call practice is for VAs.",
  no_office: "Your account isn't linked to an office yet. Ask VFDA to add you to your office.",
  office_not_enabled: "Call practice isn't on for your office yet.",
  no_phones_role: "Call practice is for VAs whose role includes Phones.",
};

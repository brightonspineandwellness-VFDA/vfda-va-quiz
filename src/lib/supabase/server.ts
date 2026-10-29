import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

// Anon client: every query is subject to row-level security.
export function createAnonClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Service-role client: bypasses row-level security. Server-only, for trusted
// jobs like grading and serving quiz items without answer keys.
export function createAdminClient() {
  const { url, serviceRoleKey } = getSupabaseEnv();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SupabaseStatus =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: string };

// Pings Supabase Auth's health endpoint with the anon key. Works before any tables exist.
export async function checkSupabase(): Promise<SupabaseStatus> {
  let env;
  try {
    env = getSupabaseEnv();
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${env.url.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: env.anonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, reason: `Supabase answered HTTP ${res.status}` };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

// Client acting as the signed-in user (from their session cookie): every query
// is subject to row-level security. Use this for almost everything.
export async function createSessionClient() {
  // Sessions are per request: never let Next.js prerender anything that touches them.
  await connection();
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

// Service-role client: bypasses row-level security. Server-only, for trusted
// jobs like grading, unlocking and sending reports. Never pass its results to a VA unfiltered.
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

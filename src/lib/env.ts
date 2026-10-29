import "server-only";

// Server-side environment. Values come from .env.local locally and from Vercel in production.
// Nothing here is prefixed NEXT_PUBLIC_, so none of it is ever sent to the browser.

export type SupabaseEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

const SUPABASE_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function missingSupabaseVars(): string[] {
  return SUPABASE_VARS.filter((name) => !process.env[name]);
}

export function getSupabaseEnv(): SupabaseEnv {
  const missing = missingSupabaseVars();
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  return {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}

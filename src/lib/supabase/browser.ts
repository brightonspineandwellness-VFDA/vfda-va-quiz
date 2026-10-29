import { createBrowserClient } from "@supabase/ssr";

// Browser client for login. Uses only the public URL and anon key; row-level
// security decides what it can read. Never import the service-role key here.
export function createBrowserSupabase() {
  // Written out in full so Next.js can inline them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.",
    );
  }
  return createBrowserClient(url, anonKey);
}

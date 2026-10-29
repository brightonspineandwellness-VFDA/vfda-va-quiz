import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { checkSupabase } from "@/lib/supabase/server";

async function SupabaseStatus() {
  // Run per request, never at build time, so the status is always live.
  await connection();
  const status = await checkSupabase();

  if (status.ok) {
    return (
      <p className="rounded-lg border border-green-600/40 bg-green-50 px-4 py-3 text-green-800 dark:bg-green-950 dark:text-green-200">
        Connected to Supabase ({status.latencyMs} ms)
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-red-600/40 bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
      <p className="font-medium">Cannot reach Supabase</p>
      <p className="mt-1 text-sm">{status.reason}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">VFDA VA Quiz App</h1>
      <Suspense
        fallback={
          <p className="rounded-lg border border-foreground/15 px-4 py-3 text-foreground/70">
            Checking Supabase…
          </p>
        }
      >
        <SupabaseStatus />
      </Suspense>
      <Link
        href="/login"
        className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background"
      >
        Sign in
      </Link>
    </main>
  );
}

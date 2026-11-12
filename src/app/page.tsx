import { connection } from "next/server";
import { Suspense } from "react";
import { Logo } from "@/components/signed-in-page";
import { ButtonLink, Notice } from "@/components/ui";
import { checkSupabase } from "@/lib/supabase/server";

async function SupabaseStatus() {
  // Run per request, never at build time, so the status is always live.
  await connection();
  const status = await checkSupabase();

  if (status.ok) {
    return (
      <Notice tone="success" role="status">
        <p>Connected to Supabase ({status.latencyMs} ms)</p>
      </Notice>
    );
  }

  return (
    <Notice tone="danger" title="Cannot reach Supabase" role="alert">
      <p className="text-sm">{status.reason}</p>
    </Notice>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      {/* The logo is a JPG on white: keep it on a white panel. */}
      <div className="flex justify-center rounded-[var(--radius-card)] border border-[#DCE1E8] bg-white px-6 py-6">
        <Logo height={64} />
      </div>
      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-6 py-6 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
        <div>
          <h1 className="text-2xl font-semibold">VFDA VA Quiz App</h1>
          <p className="mt-1 text-muted">Daily training quizzes for VFDA office VAs.</p>
        </div>
        <Suspense
          fallback={
            <Notice tone="neutral" role="status">
              <p className="text-muted">Checking Supabase…</p>
            </Notice>
          }
        >
          <SupabaseStatus />
        </Suspense>
        <ButtonLink href="/login" variant="primary" className="self-start">
          Sign in
        </ButtonLink>
      </div>
    </main>
  );
}

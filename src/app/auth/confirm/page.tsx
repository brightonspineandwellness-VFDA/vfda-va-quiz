"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { linkClass, Notice } from "@/components/ui";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// Invite links (sent by the server, so no PKCE) arrive with the session in the
// URL fragment, which only the browser can read. /auth/callback forwards here.
export default function ConfirmPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const finish = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (!access_token || !refresh_token) {
        return hash.get("error_description") ?? "This link is missing its sign-in details.";
      }
      const { error } = await createBrowserSupabase().auth.setSession({ access_token, refresh_token });
      if (error) return error.message;
      // Clear the tokens from the address bar; /login forwards to the user's own page.
      window.location.replace("/login");
      return null;
    };
    finish().then(setError, (e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16">
      {error ? (
        <>
          <Notice tone="danger" role="alert">
            <p>That link didn&apos;t work: {error.replace(/\+/g, " ")}</p>
          </Notice>
          <Link href="/login" className={linkClass}>
            Request a new sign-in link
          </Link>
        </>
      ) : (
        <p className="text-muted" role="status">Signing you in…</p>
      )}
    </main>
  );
}

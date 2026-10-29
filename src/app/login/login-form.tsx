"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const LINK_ERRORS: Record<string, string> = {
  link: "That sign-in link didn't work. It may have expired or been opened in a different browser. Request a new one below.",
};

export function LoginForm() {
  const linkError = LINK_ERRORS[useSearchParams().get("error") ?? ""];
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      const { error } = await createBrowserSupabase().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-lg border border-green-600/40 bg-green-50 px-4 py-3 text-green-800 dark:bg-green-950 dark:text-green-200">
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-sm">
          We sent a sign-in link to {email}. Open it in this same browser.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {(error ?? linkError) && (
        <p className="rounded-lg border border-red-600/40 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error ?? linkError}
        </p>
      )}
      <label htmlFor="email" className="text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-lg border border-foreground/20 bg-background px-3 py-2"
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}

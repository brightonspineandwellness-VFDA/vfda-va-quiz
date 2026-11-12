"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass, Field, Notice } from "@/components/ui";
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
      <Notice tone="success" title="Check your email" role="status">
        <p>We sent a sign-in link to {email}. Open it in this same browser.</p>
      </Notice>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {(error ?? linkError) && (
        <Notice tone="danger" role="alert">
          <p>{error ?? linkError}</p>
        </Notice>
      )}
      <Field label="Email" htmlFor="email" helper="We'll email you a link that signs you in.">
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full"
      />
      </Field>
      <button type="submit" disabled={state === "sending"} className={buttonClass("primary")}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}

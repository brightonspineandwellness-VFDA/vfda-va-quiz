"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reviewProof, setStartDate } from "@/lib/va-admin-actions";

// VFDA: accept one proof upload, or ask for a redo with a note.
export function ProofReview({ proofId }: { proofId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "accept" | "redo") =>
    startTransition(async () => {
      setError(null);
      const result = await reviewProof(proofId, decision, note);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (needed for a redo)"
        aria-label="Note to the VA"
        className="min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("accept")}
        className="rounded-lg bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-60"
      >
        Accept
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("redo")}
        className="rounded-lg border border-foreground/25 px-3 py-1 text-sm font-medium hover:bg-foreground/5 disabled:opacity-60"
      >
        Ask to redo
      </button>
      {error && <span className="text-sm text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}

export function StartDateForm({ vaId, value }: { vaId: string; value: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await setStartDate(vaId, date);
          if (!result.ok) setError(result.error);
          else router.refresh();
        });
      }}
    >
      <label className="flex items-center gap-2">
        Training start
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !date || date === value}
        className="rounded-lg border border-foreground/25 px-3 py-1 font-medium hover:bg-foreground/5 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <span className="text-red-700 dark:text-red-400">{error}</span>}
    </form>
  );
}

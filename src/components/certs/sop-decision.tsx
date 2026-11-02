"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmSop } from "@/lib/va-admin-actions";

// VFDA: what the doctor decided on Trello. A note is needed for changes or a rejection.
export function SopDecision({ certificationId }: { certificationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "approved" | "needs_changes" | "rejected") =>
    startTransition(async () => {
      setError(null);
      const result = await confirmSop(certificationId, decision, note);
      if (!result.ok) setError(result.error);
      else {
        setNote("");
        router.refresh();
      }
    });

  const button = "rounded-lg px-3 py-1 text-sm font-medium disabled:opacity-60";
  return (
    <div className="flex flex-col gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the VA (needed for changes or a rejection)"
        aria-label="Note for the VA"
        className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => decide("approved")} className={`${button} bg-foreground text-background`}>
          Doctor approved on Trello
        </button>
        <button type="button" disabled={pending} onClick={() => decide("needs_changes")} className={`${button} border border-foreground/25 hover:bg-foreground/5`}>
          Needs changes
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("rejected")}
          className={`${button} border border-red-700/40 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950`}
        >
          Rejected
        </button>
        {error && <span className="text-sm text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}

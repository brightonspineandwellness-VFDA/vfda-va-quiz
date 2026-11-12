"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
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

  return (
    <div className="flex min-w-64 flex-col gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the VA (needed for changes or a rejection)"
        aria-label="Note for the VA"
        className="w-full text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => decide("approved")} className={buttonClass("primary", "sm")}>
          Doctor approved on Trello
        </button>
        <button type="button" disabled={pending} onClick={() => decide("needs_changes")} className={buttonClass("secondary", "sm")}>
          Needs changes
        </button>
        <button type="button" disabled={pending} onClick={() => decide("rejected")} className={buttonClass("danger", "sm")}>
          Rejected
        </button>
        {error && (
          <span className="text-sm font-medium text-danger" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

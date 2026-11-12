"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
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
        className="min-w-0 flex-1 basis-48"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("accept")}
        className={buttonClass("primary", "sm")}
      >
        Accept
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("redo")}
        className={buttonClass("danger", "sm")}
      >
        Ask to redo
      </button>
      {error && <span className="text-sm font-medium text-danger">{error}</span>}
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
      <label className="flex flex-wrap items-center gap-2 font-semibold">
        Training start
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="font-normal"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !date || date === value}
        className={buttonClass("secondary", "sm")}
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <span className="font-medium text-danger">{error}</span>}
    </form>
  );
}

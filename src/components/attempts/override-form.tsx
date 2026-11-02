"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { overrideScore } from "@/lib/va-admin-actions";

// VFDA: change one item's scores (and critical flag) with a note.
export function OverrideForm({
  itemId,
  max,
  first,
  repeat,
  critical,
}: {
  itemId: string;
  max: number;
  first: number | null;
  // Undefined when the item had no repeat.
  repeat?: number | null;
  critical: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [firstScore, setFirstScore] = useState(String(first ?? ""));
  const [repeatScore, setRepeatScore] = useState(String(repeat ?? ""));
  const [criticalError, setCriticalError] = useState(critical);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scores = Array.from({ length: max + 1 }, (_, i) => String(i));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-lg border border-foreground/25 px-3 py-1 text-sm font-medium hover:bg-foreground/5"
      >
        Override score
      </button>
    );
  }

  const select = "rounded-lg border border-foreground/20 bg-transparent px-2 py-1";
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-3 py-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await overrideScore(itemId, {
            firstScore: Number(firstScore),
            repeatScore: repeat === undefined ? null : Number(repeatScore),
            criticalError,
            note,
          });
          if (!result.ok) setError(result.error);
          else {
            setOpen(false);
            setNote("");
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          First try
          <select value={firstScore} onChange={(e) => setFirstScore(e.target.value)} className={select} required>
            <option value="" disabled>
              –
            </option>
            {scores.map((s) => (
              <option key={s} value={s}>
                {s}/{max}
              </option>
            ))}
          </select>
        </label>
        {repeat !== undefined && (
          <label className="flex items-center gap-2">
            Repeat
            <select value={repeatScore} onChange={(e) => setRepeatScore(e.target.value)} className={select} required>
              <option value="" disabled>
                –
              </option>
              {scores.map((s) => (
                <option key={s} value={s}>
                  {s}/{max}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={criticalError} onChange={(e) => setCriticalError(e.target.checked)} />
          Critical error
        </label>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note: why the score changed"
        aria-label="Override note"
        required
        className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-3 py-1 font-medium text-background disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save and recalculate"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-foreground/25 px-3 py-1 font-medium hover:bg-foreground/5"
        >
          Cancel
        </button>
        {error && <span className="text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </form>
  );
}

"use client";

import { buttonClass } from "@/components/ui";
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
        className={buttonClass("secondary", "sm", "self-start")}
      >
        Override score
      </button>
    );
  }

  const select = "min-w-20";
  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface-muted px-4 py-3 text-sm"
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
        <label className="flex items-center gap-2 font-medium">
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
          <label className="flex items-center gap-2 font-medium">
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
        <label className="flex items-center gap-2 font-medium">
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
        className="w-full"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("primary", "sm")}
        >
          {pending ? "Saving…" : "Save and recalculate"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonClass("secondary", "sm")}
        >
          Cancel
        </button>
        {error && <span className="font-medium text-danger">{error}</span>}
      </div>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { buildDay, editScenario, type ScenarioEdit } from "@/lib/scenario-actions";

// Reloads the page every few seconds while a build is running.
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

// Starts a build for each day, one request per day, so each gets its own time limit.
export function BuildAllButton({ officeId, days }: { officeId: string; days: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending || days.length === 0}
        onClick={() =>
          startTransition(async () => {
            const out: string[] = [];
            for (const day of days) {
              const result = await buildDay(officeId, day);
              if (!result.ok) out.push(`${day}: ${result.error}`);
            }
            setErrors(out);
            router.refresh();
          })
        }
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
      >
        {pending ? "Starting…" : `Build ${days.length} day${days.length === 1 ? "" : "s"}`}
      </button>
      {errors.map((e) => (
        <span key={e} className="text-sm text-red-700 dark:text-red-400">
          {e}
        </span>
      ))}
    </span>
  );
}

type EditorProps = {
  id: string;
  type: "mc" | "situational";
  isRepeat: boolean;
  initial: ScenarioEdit;
};

export function ScenarioEditor({ id, type, isRepeat, initial }: EditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const area = "rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm underline">
        Edit
      </button>
    );
  }
  const field = (key: keyof ScenarioEdit, label: string, rows: number) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea rows={rows} value={edit[key]} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} className={area} />
    </label>
  );
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await editScenario(id, edit);
          if (!result.ok) return setError(result.error);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {field("stem", "Question", 3)}
      {!isRepeat && type === "mc" && (
        <>
          {field("options", "Options (one per line, in order A–D)", 4)}
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">Right answer</span>
            <input
              value={edit.answer}
              onChange={(e) => setEdit({ ...edit, answer: e.target.value })}
              maxLength={1}
              className={`${area} w-12`}
            />
          </label>
        </>
      )}
      {!isRepeat && type === "situational" && (
        <>
          {field("correctResponse", "Correct response (one step per line; keep any Say:/Do:/Book: headings)", 6)}
          {field("criticalFail", "Critical fail (blank for none)", 2)}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
        {error && <span className="text-sm text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </form>
  );
}

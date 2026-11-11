"use client";

import { useState, useTransition } from "react";
import { saveVaReport } from "@/lib/va-report-actions";

// VFDA edits the VA's coaching tips: one line per bullet. Saved text shows on
// the VA's My report at once.
export function VaTipsEditor({ attemptId, alerts, tips, strengths }: { attemptId: string; alerts: string[]; tips: string[]; strengths: string[] }) {
  const [text, setText] = useState({ alerts: alerts.join("\n"), tips: tips.join("\n"), strengths: strengths.join("\n") });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const box = (key: keyof typeof text, label: string, rows: number) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        value={text[key]}
        rows={rows}
        onChange={(e) => {
          setText({ ...text, [key]: e.target.value });
          setMessage(null);
        }}
        className="rounded-lg border border-foreground/20 bg-transparent px-3 py-2"
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      {box("alerts", "Critical errors, in general terms (one per line)", Math.max(2, alerts.length + 1))}
      {box("tips", "Coaching tips, most important first (one per line)", Math.max(4, tips.length + 2))}
      {box("strengths", "What they did well (one or two lines)", 2)}
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveVaReport(attemptId, text);
              setMessage(r.ok ? { ok: true, text: "Saved. The VA sees it now." } : { ok: false, text: r.error });
            })
          }
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save tips"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{message.text}</span>
        )}
      </span>
    </div>
  );
}

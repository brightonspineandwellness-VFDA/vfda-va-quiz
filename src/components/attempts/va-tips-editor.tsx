"use client";

import { buttonClass } from "@/components/ui";
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
      <span className="font-semibold">{label}</span>
      <textarea
        value={text[key]}
        rows={rows}
        onChange={(e) => {
          setText({ ...text, [key]: e.target.value });
          setMessage(null);
        }}
        className="w-full"
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      {box("strengths", "What went well, 4-8 lines (start a line with [Workflow name] to group it)", Math.max(5, strengths.length + 1))}
      {box("tips", "Things to focus on, most important first, 2-5 lines (end each with \"Review: <card>\")", Math.max(3, tips.length + 1))}
      {box("alerts", "Important to review: critical errors only, calm, general terms (one per line)", Math.max(2, alerts.length + 1))}
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
          className={buttonClass("primary")}
        >
          {pending ? "Saving…" : "Save report text"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "font-medium text-success" : "font-medium text-danger"}`}>{message.text}</span>
        )}
      </span>
    </div>
  );
}

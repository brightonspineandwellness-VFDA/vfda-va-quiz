"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/interview-actions";

// Runs one test send (or another one-off action) and says how it went.
export function TestButton({
  action,
  label,
  pendingLabel = "Sending…",
}: {
  action: () => Promise<ActionResult<string>>;
  label: string;
  pendingLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await action();
            setMessage(result.ok ? { ok: true, text: result.data } : { ok: false, text: result.error });
          })
        }
        className="rounded-lg border border-foreground/25 px-4 py-2 text-sm font-medium hover:bg-foreground/5 disabled:opacity-60"
      >
        {pending ? pendingLabel : label}
      </button>
      {message && (
        <span className={`text-sm ${message.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}

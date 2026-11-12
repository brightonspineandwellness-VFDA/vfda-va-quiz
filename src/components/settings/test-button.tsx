"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
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
        className={buttonClass("secondary")}
      >
        {pending ? pendingLabel : label}
      </button>
      {message && (
        <span role="status" className={`text-sm font-medium ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}

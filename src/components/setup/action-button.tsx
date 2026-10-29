"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/interview-actions";

// A button that runs one server action, then reloads the page's data.
export function ActionButton({
  action,
  label,
  pendingLabel = "Saving…",
  primary = false,
  disabled = false,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action();
            if (!result.ok) setError(result.error);
            router.refresh();
          })
        }
        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 ${
          primary ? "bg-foreground text-background" : "border border-foreground/25 hover:bg-foreground/5"
        }`}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="text-sm text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}

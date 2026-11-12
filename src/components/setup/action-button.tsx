"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/interview-actions";

// Destructive actions get the red outline.
const DESTRUCTIVE = /^(remove|delete|deactivate|reset|reject)/i;

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
        className={buttonClass(primary ? "primary" : DESTRUCTIVE.test(label) ? "danger" : "secondary")}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="text-sm font-medium text-danger" role="alert">{error}</span>}
    </span>
  );
}

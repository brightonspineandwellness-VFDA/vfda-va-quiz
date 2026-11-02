"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setStandardsAccepted } from "@/lib/setup-actions";

// The one checkbox of step 5: saved as soon as it changes.
export function StandardsCheckbox({ accepted }: { accepted: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-3 text-lg">
        <input
          type="checkbox"
          checked={accepted}
          disabled={pending}
          onChange={(e) => {
            const value = e.target.checked;
            startTransition(async () => {
              setError(null);
              const result = await setStandardsAccepted(value);
              if (!result.ok) setError(result.error);
              router.refresh();
            });
          }}
          className="mt-1.5 size-5"
        />
        <span>Anything your cards don&apos;t cover uses VFDA standards</span>
      </label>
      {pending && <span className="text-sm text-foreground/60">Saving…</span>}
      {error && <span className="text-sm text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}

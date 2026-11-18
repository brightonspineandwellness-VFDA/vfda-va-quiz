"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { setOfficeTimeZone } from "@/lib/office-settings-actions";
import { TIME_ZONES } from "@/lib/week";

// The office's time zone, for its Sunday-night emails.
export function TimeZoneForm({ officeId, value }: { officeId: string; value: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [zone, setZone] = useState(value);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const r = await setOfficeTimeZone(officeId, zone);
          if (!r.ok) setError(r.error);
          else router.refresh();
        });
      }}
    >
      <label className="flex flex-wrap items-center gap-2 font-semibold">
        Office time zone
        <select value={zone} onChange={(e) => setZone(e.target.value)} className="font-normal">
          {TIME_ZONES.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending || zone === value} className={buttonClass("secondary", "sm")}>
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <span className="font-medium text-danger">{error}</span>}
    </form>
  );
}

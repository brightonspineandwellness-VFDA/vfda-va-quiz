"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { setVaScopeAction } from "@/lib/va-invite-actions";
import { VA_SCOPES, type ScopeKey } from "@/lib/va-scope";

// "What this VA does": one checkbox per role (all checked by default). In a
// form, each checked role is sent as "scope".
export function ScopeCheckboxes({ value, onChange }: { value?: ScopeKey[]; onChange?: (keys: ScopeKey[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5 text-[0.9375rem]">
      <legend className="mb-1.5 text-sm font-semibold">What this VA does</legend>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
        {VA_SCOPES.map((s) => (
          <label key={s.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="scope"
              value={s.key}
              {...(value
                ? {
                    checked: value.includes(s.key),
                    onChange: (e) => onChange?.(e.target.checked ? [...value, s.key] : value.filter((k) => k !== s.key)),
                  }
                : { defaultChecked: true })}
            />
            {s.label}
          </label>
        ))}
      </div>
      <span className="text-sm text-muted">
        Basics &amp; VA Onboarding is always included. Days outside these roles are skipped.
      </span>
    </fieldset>
  );
}

// The VA's row on the office page: change the roles. Only days not started
// yet are added or removed; finished days and scores stay.
export function VaScopeForm({ vaId, scope }: { vaId: string; scope: ScopeKey[] }) {
  const router = useRouter();
  const [value, setValue] = useState<ScopeKey[]>(scope);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = JSON.stringify([...value].sort()) !== JSON.stringify([...scope].sort());
  return (
    <div className="flex flex-col gap-2">
      <ScopeCheckboxes value={value} onChange={setValue} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !changed}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const result = await setVaScopeAction(vaId, value);
              setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
              router.refresh();
            })
          }
          className={buttonClass("secondary", "sm")}
        >
          {pending ? "Saving…" : "Save roles"}
        </button>
        {message && (
          <span className={`text-sm font-medium ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</span>
        )}
      </div>
    </div>
  );
}

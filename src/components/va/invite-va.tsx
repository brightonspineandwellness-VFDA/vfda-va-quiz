"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { inputClass } from "@/components/interview/answer-inputs";
import { buttonClass, Field } from "@/components/ui";
import { ScopeCheckboxes } from "@/components/va/va-scope";
import { inviteVaAction, moveVaAction, type InviteVaState } from "@/lib/va-invite-actions";

export function InviteVaForm({ officeId, defaultStart }: { officeId: string; defaultStart: string }) {
  const [state, action, pending] = useActionState<InviteVaState, FormData>(inviteVaAction.bind(null, officeId), null);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      <h3 className="font-semibold">Invite VA</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="VA name" htmlFor={`${officeId}-va-name`}>
          <input id={`${officeId}-va-name`} name="name" required maxLength={200} className={inputClass} />
        </Field>
        <Field label="Email" htmlFor={`${officeId}-va-email`}>
          <input id={`${officeId}-va-email`} name="email" type="email" required className={inputClass} />
        </Field>
        <Field label="Training start" htmlFor={`${officeId}-va-start`}>
          <input id={`${officeId}-va-start`} name="startDate" type="date" required defaultValue={defaultStart} className={inputClass} />
        </Field>
      </div>
      <ScopeCheckboxes />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("primary")}
        >
          {pending ? "Inviting…" : "Invite VA"}
        </button>
        {state && (
          <p
            aria-live="polite"
            className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}
          >
            {state.message}
          </p>
        )}
      </div>
      <p className="text-sm text-muted">
        The VA gets a sign-in link by email. They only see this office&apos;s days that VFDA approved.
      </p>
    </form>
  );
}

// Move to another office: training there starts again on the date picked.
export function MoveVaForm({
  vaId,
  offices,
  defaultStart,
}: {
  vaId: string;
  offices: { id: string; name: string }[];
  defaultStart: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [office, setOffice] = useState("");
  const [date, setDate] = useState(defaultStart);
  const [error, setError] = useState<string | null>(null);
  if (!offices.length) return null;

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await moveVaAction(vaId, office, date);
          if (!result.ok) setError(result.error);
          else router.refresh();
        });
      }}
    >
      <label className="flex flex-wrap items-center gap-2">
        Move to
        <select
          value={office}
          onChange={(e) => setOffice(e.target.value)}
          className="min-w-0"
        >
          <option value="">Pick an office</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-wrap items-center gap-2">
        starting
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-w-0"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !office || !date}
        className={buttonClass("secondary", "sm")}
      >
        {pending ? "Moving…" : "Move"}
      </button>
      {error && <span className="font-medium text-danger">{error}</span>}
    </form>
  );
}

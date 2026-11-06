"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { inputClass } from "@/components/interview/answer-inputs";
import { ScopeCheckboxes } from "@/components/va/va-scope";
import { inviteVaAction, moveVaAction, type InviteVaState } from "@/lib/va-invite-actions";

export function InviteVaForm({ officeId, defaultStart }: { officeId: string; defaultStart: string }) {
  const [state, action, pending] = useActionState<InviteVaState, FormData>(inviteVaAction.bind(null, officeId), null);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-foreground/15 p-4">
      <h3 className="font-semibold">Invite VA</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">VA name</span>
          <input name="name" required maxLength={200} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Email</span>
          <input name="email" type="email" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Training start</span>
          <input name="startDate" type="date" required defaultValue={defaultStart} className={inputClass} />
        </label>
      </div>
      <ScopeCheckboxes />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Inviting…" : "Invite VA"}
        </button>
        {state && (
          <p
            aria-live="polite"
            className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
          >
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-foreground/60">
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
      <label className="flex items-center gap-2">
        Move to
        <select
          value={office}
          onChange={(e) => setOffice(e.target.value)}
          className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1"
        >
          <option value="">Pick an office</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        starting
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !office || !date}
        className="rounded-lg border border-foreground/25 px-3 py-1 font-medium hover:bg-foreground/5 disabled:opacity-60"
      >
        {pending ? "Moving…" : "Move"}
      </button>
      {error && <span className="text-red-700 dark:text-red-400">{error}</span>}
    </form>
  );
}

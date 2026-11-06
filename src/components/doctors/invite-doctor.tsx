"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/interview/answer-inputs";
import { inviteDoctorAction, type InviteDoctorState } from "@/lib/doctor-invite-actions";

// Can be used as often as needed: each doctor gets their own login for this office.
export function InviteDoctorForm({ officeId }: { officeId: string }) {
  const [state, action, pending] = useActionState<InviteDoctorState, FormData>(inviteDoctorAction.bind(null, officeId), null);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-foreground/15 p-4">
      <h3 className="font-semibold">Invite doctor</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Doctor name</span>
          <input name="name" required maxLength={200} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Email</span>
          <input name="email" type="email" required className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Inviting…" : "Invite doctor"}
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
        The doctor gets a sign-in link by email. Every doctor of the office sees and can do the same things; reports go to
        all of them.
      </p>
    </form>
  );
}

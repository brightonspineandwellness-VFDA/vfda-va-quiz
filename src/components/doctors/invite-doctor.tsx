"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/interview/answer-inputs";
import { buttonClass } from "@/components/ui";
import { inviteDoctorAction, type InviteDoctorState } from "@/lib/doctor-invite-actions";

// Can be used as often as needed: each doctor gets their own login for this office.
export function InviteDoctorForm({ officeId }: { officeId: string }) {
  const [state, action, pending] = useActionState<InviteDoctorState, FormData>(inviteDoctorAction.bind(null, officeId), null);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.06)] sm:px-6">
      <h3 className="text-base font-semibold">Invite doctor</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Doctor name</span>
          <input name="name" required maxLength={200} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Email</span>
          <input name="email" type="email" required className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("primary")}
        >
          {pending ? "Inviting…" : "Invite doctor"}
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
        The doctor gets a sign-in link by email. Every doctor of the office sees and can do the same things; reports go to
        all of them.
      </p>
    </form>
  );
}

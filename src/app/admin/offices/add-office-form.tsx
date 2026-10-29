"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/interview/answer-inputs";
import { addOffice, type AddOfficeState } from "./actions";

export function AddOfficeForm() {
  const [state, action, pending] = useActionState<AddOfficeState, FormData>(addOffice, null);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-foreground/15 p-4">
      <h2 className="font-semibold">Add office</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Office name" name="officeName" />
        <Field label="Doctor name" name="doctorName" />
        <Field label="Doctor email" name="doctorEmail" type="email" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add office and invite doctor"}
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
    </form>
  );
}

function Field({ label, name, type = "text" }: { label: string; name: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input name={name} type={type} required className={inputClass} />
    </label>
  );
}

"use client";

import { useActionState } from "react";
import { buttonClass, Card, Field } from "@/components/ui";
import { addOffice, type AddOfficeState } from "./actions";

export function AddOfficeForm() {
  const [state, action, pending] = useActionState<AddOfficeState, FormData>(addOffice, null);

  return (
    <Card title="Add office" description="Adds the office and emails the doctor an invite.">
      <form action={action} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Office name" name="officeName" />
          <Input label="Doctor name" name="doctorName" />
          <Input label="Doctor email" name="doctorEmail" type="email" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Adding…" : "Add office and invite doctor"}
          </button>
          {state && (
            <p aria-live="polite" className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}>
              {state.message}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

function Input({ label, name, type = "text" }: { label: string; name: string; type?: string }) {
  const id = `add-office-${name}`;
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} name={name} type={type} required className="w-full" />
    </Field>
  );
}

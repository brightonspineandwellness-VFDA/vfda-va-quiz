"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { inputClass } from "@/components/interview/answer-inputs";
import { reextractExtraWorkflowAction, saveExtraWorkflow, setExtraWorkflowApproved, type ExtraWorkflowEdit } from "@/lib/extra-workflow-actions";

export type ExtraWorkflowView = ExtraWorkflowEdit & {
  id: string;
  code: string;
  approved: boolean;
  cardTitle: string;
  quotes: { field: string; quote: string }[];
  patientFacing: boolean;
  risky: boolean;
};

const LIST_FIELDS = [
  ["steps", "Steps, in order (one per line)"],
  ["va_can_decide", "The VA can decide (one per line)"],
  ["requires_approval", "Needs approval (one per line)"],
  ["immediate_escalation", "Escalate at once (one per line)"],
] as const;

// One extra card's workflow, as read from the card, for VFDA to edit and
// approve. Scenarios are built only from approved workflows.
export function ExtraWorkflowEditor({ workflow }: { workflow: ExtraWorkflowView }) {
  const router = useRouter();
  const [w, setW] = useState(workflow);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error ?? "Couldn't save.");
      else setEditing(false);
      router.refresh();
    });
  const set = <K extends keyof ExtraWorkflowEdit>(key: K, value: ExtraWorkflowEdit[K]) => setW({ ...w, [key]: value });
  const button = "rounded-lg border border-foreground/25 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:opacity-60";

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">
          {workflow.code} {workflow.name}
        </span>
        <span className="text-foreground/60">from {workflow.cardTitle}</span>
        <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-medium">{workflow.kind === "process" ? "Process" : "Info only"}</span>
        {workflow.kind === "process" && workflow.phone !== "none" && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">
            Phone call: built into {workflow.phone === "routine" ? "W2D1" : "W2D2"}
          </span>
        )}
        {(workflow.patientFacing || workflow.risky) && (
          <span className="text-xs text-foreground/60">{[workflow.patientFacing && "patient-facing", workflow.risky && "risky"].filter(Boolean).join(", ")}</span>
        )}
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            workflow.approved ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {workflow.approved ? "Approved" : "Waiting for VFDA"}
        </span>
      </div>

      {!editing ? (
        <>
          {workflow.trigger && <p>Starts when: {workflow.trigger}</p>}
          {workflow.steps.length > 0 && (
            <ol className="list-decimal pl-5">
              {workflow.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {workflow.definition_of_done && <p>Done when: {workflow.definition_of_done}</p>}
          {workflow.va_can_decide.length > 0 && <p>The VA decides: {workflow.va_can_decide.join("; ")}</p>}
          {workflow.requires_approval.length > 0 && <p>Needs approval: {workflow.requires_approval.join("; ")}</p>}
          {workflow.immediate_escalation.length > 0 && <p>Escalate at once: {workflow.immediate_escalation.join("; ")}</p>}
          {workflow.quotes.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-foreground/60 italic">
              {workflow.quotes.map((q, i) => (
                <li key={i}>
                  {q.field.replace(/_/g, " ")}: &ldquo;{q.quote}&rdquo;
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Name</span>
            <input value={w.name} onChange={(e) => set("name", e.target.value)} className={inputClass} />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-medium">Kind</span>
              <select value={w.kind} onChange={(e) => set("kind", e.target.value as ExtraWorkflowEdit["kind"])} className={inputClass}>
                <option value="process">Process (has steps)</option>
                <option value="info">Info only</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-medium">Phone call?</span>
              <select value={w.phone} onChange={(e) => set("phone", e.target.value as ExtraWorkflowEdit["phone"])} className={inputClass} disabled={w.kind !== "process"}>
                <option value="none">No (W2D5)</option>
                <option value="routine">Routine call (W2D1)</option>
                <option value="advanced">Challenging call (W2D2)</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Starts when</span>
            <textarea value={w.trigger} onChange={(e) => set("trigger", e.target.value)} rows={2} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Done when</span>
            <textarea value={w.definition_of_done} onChange={(e) => set("definition_of_done", e.target.value)} rows={2} className={inputClass} />
          </label>
          {LIST_FIELDS.map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="font-medium">{label}</span>
              <textarea value={w[key].join("\n")} onChange={(e) => set(key, e.target.value.split("\n"))} rows={key === "steps" ? 6 : 3} className={inputClass} />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              disabled={pending}
              className={`${button} bg-foreground text-background`}
              onClick={() => run(() => saveExtraWorkflow(workflow.id, { ...w, steps: w.steps.map((s) => s.trim()).filter(Boolean) }))}
            >
              {pending ? "Saving…" : "Save and approve"}
            </button>
            <button type="button" disabled={pending} className={button} onClick={() => (setW(workflow), setEditing(false))}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {!workflow.approved ? (
              <button type="button" disabled={pending} className={`${button} bg-foreground text-background`} onClick={() => run(() => setExtraWorkflowApproved(workflow.id, true))}>
                Approve
              </button>
            ) : (
              <button type="button" disabled={pending} className={button} onClick={() => run(() => setExtraWorkflowApproved(workflow.id, false))}>
                Un-approve
              </button>
            )}
            <button type="button" disabled={pending} className={button} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" disabled={pending} className={button} onClick={() => run(() => reextractExtraWorkflowAction(workflow.id))}>
              {pending ? "Working…" : "Read the card again"}
            </button>
          </>
        )}
        {error && <span className="text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </article>
  );
}

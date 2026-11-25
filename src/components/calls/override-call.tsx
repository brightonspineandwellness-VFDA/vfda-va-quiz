"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { overrideCall } from "@/lib/call-practice/admin-actions";

// VFDA: set a call's result by hand, with a note, or remove an override.
export function OverrideCall({ id, current }: { id: string; current: "passed" | "practice_again" | null }) {
  const router = useRouter();
  const [result, setResult] = useState<"passed" | "practice_again">(current ?? "passed");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (value: "passed" | "practice_again" | null) =>
    start(async () => {
      setError(null);
      const r = await overrideCall(id, value, note);
      if (!r.ok) setError(r.error);
      else {
        setNote("");
        router.refresh();
      }
    });

  return (
    <Card title="Override the result" description="The override replaces the call's result in progress, pass rates and reports.">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Result</legend>
        {(["passed", "practice_again"] as const).map((v) => (
          <label key={v} className="inline-flex items-center gap-2">
            <input type="radio" name={`override-${id}`} id={`override-${id}-${v}`} checked={result === v} onChange={() => setResult(v)} />
            {v === "passed" ? "Passed" : "Practice again"}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`override-note-${id}`} className="font-medium">
        Note (required)
      </label>
      <textarea id={`override-note-${id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the result changed" />
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={() => run(result)}>
          {pending ? "Saving…" : "Save override"}
        </Button>
        {current && (
          <Button variant="danger" disabled={pending} onClick={() => run(null)}>
            Remove override
          </Button>
        )}
      </div>
    </Card>
  );
}

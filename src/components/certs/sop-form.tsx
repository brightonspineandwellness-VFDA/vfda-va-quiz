"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { buttonClass, Field } from "@/components/ui";
import { submitSop } from "@/lib/va-actions";

// The VA pastes the Trello card link(s) for one workflow and says it's updated.
export function SopForm({ certificationId, links }: { certificationId: string; links: string[] }) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(links.join("\n"));
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await submitSop(certificationId, text);
          if (!result.ok) setError(result.error);
          else router.refresh();
        });
      }}
    >
      <Field label="Trello card link(s), one per line" htmlFor={id} error={error}>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(2, text.split("\n").length)}
          placeholder="https://trello.com/c/..."
          className="w-full font-mono text-sm"
        />
      </Field>
      <div>
        <button type="submit" disabled={pending || !text.trim()} className={buttonClass("primary")}>
          {pending ? "Saving…" : "Card updated"}
        </button>
      </div>
    </form>
  );
}

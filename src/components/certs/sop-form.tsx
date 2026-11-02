"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitSop } from "@/lib/va-actions";

// The VA pastes the Trello card link(s) for one workflow and says it's updated.
export function SopForm({ certificationId, links }: { certificationId: string; links: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(links.join("\n"));
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-2 text-sm"
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
      <label className="flex flex-col gap-1">
        <span className="font-medium">Trello card link(s), one per line</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(2, text.split("\n").length)}
          placeholder="https://trello.com/c/..."
          className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1 font-mono text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-60"
        >
          {pending ? "Saving…" : "Card updated"}
        </button>
        {error && <span className="text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </form>
  );
}

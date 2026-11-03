"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerMissingRule } from "@/lib/scenario-actions";
import type { MissingRule } from "@/lib/scenario-data";

// One box per missing {KEY}: the office's answer becomes an accepted rule and
// refills every scenario of the office that waits for it.
export function RuleAnswerBox({ officeId, rule }: { officeId: string; rule: MissingRule }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const list = rule.answerType === "list";

  if (!rule.slot) {
    return (
      <p className="text-sm">
        <code className="font-mono">{rule.key}</code>: not an office rule. Edit the scenario instead.
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-1 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setMessage(null);
          const result = await answerMissingRule(officeId, rule.key, text);
          setMessage(result.ok ? { ok: true, text: result.data } : { ok: false, text: result.error });
          if (result.ok) {
            setText("");
            router.refresh();
          }
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span>
          <code className="font-mono font-medium">{rule.key}</code>
          {rule.question && <span className="text-foreground/70"> · {rule.question}</span>}
        </span>
        {rule.answerType === "matrix" ? (
          <span className="text-foreground/60">A table: answer it on the Cards &amp; rules page.</span>
        ) : (
          <textarea
            rows={list ? 3 : 1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={list ? "One per line" : rule.answerType === "yesno" ? "yes or no" : "The office's answer"}
            className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1"
          />
        )}
      </label>
      {rule.answerType !== "matrix" && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="rounded-lg bg-foreground px-3 py-1 font-medium text-background disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save rule"}
          </button>
          {message && <span className={message.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>{message.text}</span>}
        </div>
      )}
    </form>
  );
}

// Scenario text with every {KEY} still blank highlighted.
export function Blanks({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[A-Z][A-Z0-9_]*\})/).map((part, i) =>
        /^\{[A-Z][A-Z0-9_]*\}$/.test(part) ? (
          <mark key={i} className="rounded bg-amber-300/40 px-1 font-mono text-amber-900 dark:bg-amber-400/25 dark:text-amber-200">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

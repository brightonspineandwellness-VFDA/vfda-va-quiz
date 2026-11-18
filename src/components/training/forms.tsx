"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { markSessionDone, saveSheet, sendThisWeekTest, type SheetForm } from "@/lib/training-actions";
import type { Sheet } from "@/lib/training-plan";

// "Mark session done", with an optional note.
export function MarkDoneForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        Mark session done
      </button>
    );
  return (
    <form
      className="flex w-full min-w-56 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const r = await markSessionDone(sessionId, note);
          if (!r.ok) setError(r.error);
          else router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Note (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="w-full" />
      </label>
      <span className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "Saving…" : "Session done"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>
          Cancel
        </button>
      </span>
      {error && <span className="text-sm font-medium text-danger">{error}</span>}
    </form>
  );
}

// "Send this week now (test email)": the next week's emails to one address.
export function TestSendForm({ vaId, defaultTo }: { vaId: string; defaultTo: string }) {
  const [to, setTo] = useState(defaultTo);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setMessage(null);
          const r = await sendThisWeekTest(vaId, to);
          setMessage(r.ok ? { ok: true, text: r.data } : { ok: false, text: r.error });
        });
      }}
    >
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex flex-wrap items-center gap-2 font-semibold">
          Test address
          <input type="email" required value={to} onChange={(e) => setTo(e.target.value)} className="min-w-64 font-normal" />
        </label>
        <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
          {pending ? "Sending…" : "Send this week now (test email)"}
        </button>
      </span>
      {message && <span className={`text-sm font-medium ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</span>}
    </form>
  );
}

// VFDA edits a sheet before it's sent: one line per bullet.
export function SheetEditor({ sessionId, sheet, backHref }: { sessionId: string; sheet: Sheet; backHref: string }) {
  const router = useRouter();
  const [form, setForm] = useState<SheetForm>({
    title: sheet.title,
    buildOn: sheet.buildOn,
    summary: sheet.summary,
    explain: sheet.explain.join("\n"),
    emailLine: sheet.emailLine,
    wrapUp: sheet.wrapUp.join("\n"),
    scenarios: sheet.scenarios.map((s) => ({ ask: s.ask, listenFor: s.listenFor.join("\n"), followUp: s.followUp, card: s.card })),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = (label: string, value: string, set: (v: string) => void, rows = 1) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {rows > 1 ? (
        <textarea rows={rows} value={value} onChange={(e) => set(e.target.value)} className="w-full" />
      ) : (
        <input value={value} onChange={(e) => set(e.target.value)} className="w-full" />
      )}
    </label>
  );
  const setScenario = (n: number, key: keyof SheetForm["scenarios"][number], v: string) =>
    setForm({ ...form, scenarios: form.scenarios.map((s, i) => (i === n ? { ...s, [key]: v } : s)) });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const r = await saveSheet(sessionId, form);
          if (!r.ok) setError(r.error);
          else router.push(backHref);
        });
      }}
    >
      {field("Title (the focus)", form.title, (v) => setForm({ ...form, title: v }))}
      {field("Build on (the strength)", form.buildOn, (v) => setForm({ ...form, buildOn: v }))}
      {field("1. What you'll go through", form.summary, (v) => setForm({ ...form, summary: v }), 4)}
      {field("2. The 5-minute explanation (one point per line)", form.explain, (v) => setForm({ ...form, explain: v }), 3)}
      {form.scenarios.map((s, n) => (
        <fieldset key={n} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line p-3">
          <legend className="px-1 text-sm font-semibold">
            Scenario {n + 1} ({sheet.scenarios[n]?.kind === "focus" ? "Practice" : "Builds on a strength"})
          </legend>
          {field("Ask", s.ask, (v) => setScenario(n, "ask", v), 2)}
          {field("Listen for (one per line)", s.listenFor, (v) => setScenario(n, "listenFor", v), 4)}
          {field("Follow-up", s.followUp, (v) => setScenario(n, "followUp", v))}
          {field("Card to review", s.card, (v) => setScenario(n, "card", v))}
        </fieldset>
      ))}
      {field("4. Wrap-up: exactly 2 questions, one per line", form.wrapUp, (v) => setForm({ ...form, wrapUp: v }), 2)}
      {field("The line in the doctor's email", form.emailLine, (v) => setForm({ ...form, emailLine: v }), 2)}
      <span className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Saving…" : "Save sheet"}
        </button>
        {error && <span className="text-sm font-medium text-danger">{error}</span>}
      </span>
    </form>
  );
}

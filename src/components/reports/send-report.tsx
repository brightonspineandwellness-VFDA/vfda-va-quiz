"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { sendReportTo } from "@/lib/va-admin-actions";

// "Send report": to the doctor (the full send again: VFDA email, Slack and
// Leads4Life), or a test email to one address (nothing else is sent).
export function SendReport({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"doctor" | "test">("doctor");
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        Send report
      </button>
    );
  }
  return (
    <form
      className="flex min-w-56 flex-col gap-2 rounded-[var(--radius-control)] border border-line p-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setMessage(null);
          const r = await sendReportTo(attemptId, target, email);
          setMessage(r.ok ? { ok: true, text: r.data } : { ok: false, text: r.error });
          router.refresh();
        });
      }}
    >
      <label className="flex items-center gap-2">
        <input type="radio" name={`to-${attemptId}`} checked={target === "doctor"} onChange={() => setTarget("doctor")} />
        Doctor (VFDA email, Slack, Leads4Life)
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name={`to-${attemptId}`} checked={target === "test"} onChange={() => setTarget("test")} />
        Test email only
      </label>
      {target === "test" && (
        <input type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Test email address" />
      )}
      <span className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "Sending…" : "Send"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>
          Cancel
        </button>
      </span>
      {message && <span className={`font-medium ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</span>}
    </form>
  );
}

import "server-only";

// The admin Reports page (/admin/reports): every finished quiz attempt,
// newest first, with its score, label, critical errors, flags and where its
// report went (VFDA email, Slack, Leads4Life). Read with the admin client;
// the page checks the role first.

import { LEADS4LIFE, SLACK_RECIPIENT } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { attemptLabel, RESULT_LABELS, type ResultLabel } from "@/lib/va-flow";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export const MAX_ROWS = 300;

export type ReportFilters = {
  office?: string;
  va?: string;
  day?: string;
  label?: ResultLabel;
  from?: string; // YYYY-MM-DD
  to?: string;
  critical?: boolean;
  failed?: boolean;
};

export type Delivery = "sent" | "failed" | "sending" | "not sent";

export type ReportRow = {
  id: string;
  submittedAt: string;
  officeId: string | null;
  officeName: string;
  vaId: string;
  vaName: string;
  day: string; // "W1D2", "W1D2 RETAKE", "Retrain", ...
  topic: string;
  retake: boolean;
  points: number;
  max: number;
  result: ResultLabel | null;
  label: string;
  criticalErrors: number;
  flags: string[];
  delivery: { email: Delivery; slack: Delivery; leads4life: Delivery };
  errors: string[]; // why a send failed
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The query string, checked: anything unknown is dropped.
export function parseFilters(q: Record<string, string | string[] | undefined>): ReportFilters {
  const one = (k: string) => {
    const v = q[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const label = one("label");
  return {
    office: UUID.test(one("office") ?? "") ? one("office") : undefined,
    va: UUID.test(one("va") ?? "") ? one("va") : undefined,
    day: /^[A-Z0-9]{2,8}$/i.test(one("day") ?? "") ? one("day")!.toUpperCase() : undefined,
    label: label && label in RESULT_LABELS ? (label as ResultLabel) : undefined,
    from: DATE.test(one("from") ?? "") ? one("from") : undefined,
    to: DATE.test(one("to") ?? "") ? one("to") : undefined,
    critical: one("critical") === "1",
    failed: one("failed") === "1",
  };
}

type Note = { attempt_id: string; event: string; channel: string; recipient: string; status: string; error: string | null };

// One channel's status for the latest send of the report (the automatic one,
// or the last "Send report"). Any failed row: failed.
function deliveryOf(rows: Note[]): Delivery {
  if (!rows.length) return "not sent";
  if (rows.some((r) => r.status === "failed")) return "failed";
  if (rows.some((r) => r.status === "pending")) return "sending";
  return rows.every((r) => r.status === "sent") ? "sent" : "not sent";
}

export function deliveries(notes: Note[]) {
  // The report sends: event "" (automatic) and "again:<time>" (Send report). Critical alerts aren't the report.
  const report = notes.filter((n) => n.event === "" || n.event.startsWith("again:"));
  const latest = report.map((n) => n.event).sort().at(-1);
  const mine = report.filter((n) => n.event === latest);
  const email = mine.filter((n) => n.channel === "email");
  const slack = mine.filter((n) => n.channel === "slack" || n.recipient === SLACK_RECIPIENT);
  const leads = mine.filter((n) => n.channel === LEADS4LIFE);
  return {
    delivery: { email: deliveryOf(email), slack: deliveryOf(slack), leads4life: deliveryOf(leads) },
    errors: mine.filter((n) => n.status === "failed").map((n) => `${n.channel === LEADS4LIFE ? `Leads4Life (${n.recipient})` : n.recipient}: ${n.error ?? "not sent"}`),
  };
}

export async function loadReportRows(f: ReportFilters, db: Db = createAdminClient()) {
  let q = db
    .from("attempts")
    .select("id, va_id, office_id, schedule_day, kind, submitted_at, first_try_points, max_points, result, critical_errors, fast_finish, paste_log")
    .not("submitted_at", "is", null)
    .not("result", "is", null)
    .is("archived_at", null)
    .order("submitted_at", { ascending: false })
    .limit(MAX_ROWS);
  if (f.office) q = q.eq("office_id", f.office);
  if (f.va) q = q.eq("va_id", f.va);
  if (f.day) q = q.eq("schedule_day", f.day);
  if (f.label) q = q.eq("result", f.label);
  // Dates are whole days in UTC.
  if (f.from) q = q.gte("submitted_at", `${f.from}T00:00:00Z`);
  if (f.to) q = q.lte("submitted_at", `${f.to}T23:59:59.999Z`);
  if (f.critical) q = q.gt("critical_errors", 0);
  const attempts = must(await q) ?? [];

  const ids = attempts.map((a) => a.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [offices, vas, days, notes, items] = await Promise.all([
    db.from("offices").select("id, name").order("name"),
    db.from("profiles").select("id, full_name, email, office_id").eq("role", "va").order("full_name"),
    db.from("schedule_days").select("code, title").order("code"),
    db.from("notifications").select("attempt_id, event, channel, recipient, status, error").in("attempt_id", ids.length ? ids : none),
    db.from("attempt_items").select("attempt_id, paste_log").in("attempt_id", ids.length ? ids : none),
  ]);
  const officeOf = new Map((must(offices) ?? []).map((o) => [o.id, o.name as string]));
  const vaRows = must(vas) ?? [];
  const vaOf = new Map(vaRows.map((v) => [v.id, (v.full_name || v.email || "VA") as string]));
  const titleOf = new Map((must(days) ?? []).map((d) => [d.code, d.title as string]));
  const notesOf = new Map<string, Note[]>();
  for (const n of (must(notes) ?? []) as Note[]) notesOf.set(n.attempt_id, [...(notesOf.get(n.attempt_id) ?? []), n]);
  const pastedOf = new Map<string, number>();
  for (const i of must(items) ?? []) if (Array.isArray(i.paste_log) && i.paste_log.length) pastedOf.set(i.attempt_id, (pastedOf.get(i.attempt_id) ?? 0) + 1);

  const rows: ReportRow[] = attempts.map((a) => {
    const result = a.result && a.result in RESULT_LABELS ? (a.result as ResultLabel) : null;
    const pasted = pastedOf.get(a.id) ?? 0;
    return {
      id: a.id,
      submittedAt: a.submitted_at!,
      officeId: a.office_id,
      officeName: officeOf.get(a.office_id) ?? "–",
      vaId: a.va_id,
      vaName: vaOf.get(a.va_id) ?? "VA",
      day: attemptLabel(a).replace(" RETAKE", ""),
      topic: titleOf.get(a.schedule_day) ?? "",
      retake: a.kind === "retake",
      points: Number(a.first_try_points ?? 0),
      max: a.max_points ?? 0,
      result,
      label: result ? RESULT_LABELS[result] : (a.result ?? "–"),
      criticalErrors: a.critical_errors ?? 0,
      flags: [a.fast_finish && "fast finish", pasted > 0 && `${pasted} pasted answer${pasted === 1 ? "" : "s"}`].filter((x): x is string => !!x),
      ...deliveries(notesOf.get(a.id) ?? []),
    };
  });
  const filtered = f.failed ? rows.filter((r) => Object.values(r.delivery).includes("failed")) : rows;
  return {
    rows: filtered,
    capped: attempts.length === MAX_ROWS,
    options: {
      offices: [...officeOf].map(([id, name]) => ({ id, name })),
      vas: vaRows
        .filter((v) => !f.office || v.office_id === f.office)
        .map((v) => ({ id: v.id as string, name: (v.full_name || v.email || "VA") as string })),
      days: (must(days) ?? []).map((d) => ({ code: d.code as string, title: d.title as string })),
    },
  };
}

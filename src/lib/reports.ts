import "server-only";

// Sends the results report after every attempt: an email (Resend, from
// REPORT_FROM, reply-to REPORT_REPLY_TO) to VFDA (REPORT_TO_VFDA) and to the
// office's doctor, and a Slack post to VFDA (SLACK_WEBHOOK_URL). One
// notifications row per recipient is written before sending, so running this
// again only sends what hasn't gone out yet. Each send is tried twice.

import {
  reportHtml,
  reportSections,
  reportSlack,
  reportText,
  workflowStatus,
  type AttemptReport,
  type ReportItem,
} from "@/lib/report";
import { createAdminClient } from "@/lib/supabase/server";
import { withOverride } from "@/lib/va-flow";

type Db = ReturnType<typeof createAdminClient>;
const TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 2000;
// Matches the default settings.grading.low_confidence_below.
const LOW_CONFIDENCE = 0.7;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// The app's address for links in reports: APP_URL, else Vercel's production URL.
export function appUrl() {
  const url =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return url.replace(/\/+$/, "");
}

export const attemptLink = (attemptId: string, area: "admin" | "doctor") => `${appUrl()}/${area}/attempts/${attemptId}`;

type Feedback = { missed_steps?: string[] } | null;

export async function loadAttemptReport(db: Db, attemptId: string) {
  const attempt = must(
    await db
      .from("attempts")
      .select("id, va_id, office_id, schedule_day, version, first_try_points, max_points, result, time_spent, paste_log, fast_finish, submitted_at")
      .eq("id", attemptId)
      .maybeSingle(),
  );
  if (!attempt?.submitted_at || !attempt.result) return null;

  const [va, office, day, doctors, attempts, workflows, grayWorkflows, certifications] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", attempt.va_id).maybeSingle(),
    db.from("offices").select("name").eq("id", attempt.office_id).maybeSingle(),
    db.from("schedule_days").select("title").eq("code", attempt.schedule_day).maybeSingle(),
    db.from("profiles").select("email").eq("office_id", attempt.office_id).eq("role", "doctor"),
    db.from("attempts").select("id").eq("va_id", attempt.va_id).not("submitted_at", "is", null),
    db.from("workflows").select("code, name"),
    db.from("office_workflows").select("code, name, card_answers").eq("office_id", attempt.office_id),
    db.from("certifications").select("workflow, office_workflow_id, status, doctor_decision").eq("va_id", attempt.va_id),
  ]);

  // Every graded item of this VA so far: this attempt's for the report, all of
  // them for the workflow statuses.
  const attemptIds = (must(attempts) ?? []).map((a) => a.id);
  const allItems =
    must(
      await db
        .from("attempt_items")
        .select(
          "attempt_id, office_scenario_id, first_score, first_feedback, repeat_scenario_id, repeat_score, critical_error, critical_quote, ai_confidence, vfda_override, fast, position",
        )
        .in("attempt_id", attemptIds.length ? attemptIds : [attemptId]),
    ) ?? [];
  const scenarioIds = [...new Set(allItems.map((i) => i.office_scenario_id))];
  const scenarios =
    must(
      await db
        .from("office_scenarios")
        .select("id, code, workflow, type, points, office_workflow_id")
        .in("id", scenarioIds.length ? scenarioIds : ["00000000-0000-0000-0000-000000000000"]),
    ) ?? [];
  const scenarioOf = new Map(scenarios.map((s) => [s.id, s]));

  const toItem = (row: (typeof allItems)[number]): ReportItem | null => {
    const s = scenarioOf.get(row.office_scenario_id);
    if (!s) return null;
    // A VFDA override replaces the grader's scores.
    const i = withOverride({ ...row, ai_confidence: row.ai_confidence === null ? null : Number(row.ai_confidence) }, row.vfda_override);
    return {
      code: s.code,
      workflow: s.workflow,
      type: s.type,
      points: s.points,
      first_score: i.first_score,
      repeat_score: i.repeat_score,
      repeated: !!i.repeat_scenario_id,
      missed_steps: ((i.first_feedback as Feedback)?.missed_steps ?? []).map(String),
      critical_error: i.critical_error,
      critical_quote: i.critical_quote,
      fast: i.fast,
      low_confidence: s.type === "situational" && i.ai_confidence !== null && i.ai_confidence < LOW_CONFIDENCE,
      overridden: !!row.vfda_override,
    };
  };
  const mine = allItems
    .filter((i) => i.attempt_id === attemptId)
    .sort((a, b) => a.position - b.position)
    .map(toItem)
    .filter((i): i is ReportItem => !!i);

  const names = new Map<string, string>((must(workflows) ?? []).map((w) => [w.code, w.name]));
  for (const g of must(grayWorkflows) ?? []) {
    names.set(g.code, g.name || String((g.card_answers as Record<string, unknown>)?.CARD_NAME ?? g.code));
  }
  const certs = must(certifications) ?? [];
  const dayWorkflows = [...new Set(mine.map((i) => i.workflow))].sort();
  const everything = allItems.map(toItem).filter((i): i is ReportItem => !!i);

  const report: AttemptReport = {
    vaName: must(va)?.full_name || must(va)?.email || "VA",
    officeName: must(office)?.name ?? "Office",
    dayCode: attempt.schedule_day,
    dayTitle: must(day)?.title ?? "",
    version: attempt.version,
    points: Number(attempt.first_try_points ?? 0),
    maxPoints: attempt.max_points ?? 0,
    result: attempt.result,
    timeSpent: attempt.time_spent,
    fastFinish: attempt.fast_finish,
    pastes: Array.isArray(attempt.paste_log) ? attempt.paste_log.length : 0,
    items: mine,
    workflows: dayWorkflows.map((code) => ({
      code,
      name: names.get(code) ?? code,
      ...workflowStatus(
        everything.filter((i) => i.workflow === code),
        certs.find((c) => c.workflow === code) ?? null,
      ),
    })),
  };
  const doctorEmails = (must(doctors) ?? []).map((d) => d.email).filter(Boolean) as string[];
  return { report, doctorEmails };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

async function sendEmail(to: string, subject: string, html: string, text: string, idempotencyKey: string) {
  const key = process.env.RESEND_API_KEY;
  const from = reportFrom();
  if (!key || !from) throw new Error("Email isn't set up: RESEND_API_KEY and REPORT_FROM are needed.");
  const replyTo = process.env.REPORT_REPLY_TO?.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Resend answered ${res.status}${body?.message ? `: ${body.message}` : ""}`);
  }
}

async function postSlack(payload: { text: string }) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("Slack isn't set up: SLACK_WEBHOOK_URL is needed.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Slack answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

// Runs a send, and once more if it fails. Null when it went out, else the last error.
async function tryTwice(send: () => Promise<void>): Promise<string | null> {
  let error = "";
  for (let i = 0; i < 2; i++) {
    try {
      await send();
      return null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      // Missing settings won't fix themselves.
      if (error.includes("isn't set up")) break;
      if (i === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  return error;
}

// REPORT_FROM_EMAIL and VFDA_REPORT_EMAIL are the earlier names, still read.
export const reportFrom = () => (process.env.REPORT_FROM || process.env.REPORT_FROM_EMAIL || "").trim();

export const vfdaEmails = () =>
  (process.env.REPORT_TO_VFDA || process.env.VFDA_REPORT_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));

// The Slack row's recipient. The webhook URL itself is a secret and is never stored.
export const SLACK_RECIPIENT = "VFDA Slack";

// ---------------------------------------------------------------------------
// Test buttons (/admin/settings)
// ---------------------------------------------------------------------------

export async function sendTestEmail(): Promise<{ sentTo: string[]; error: string | null }> {
  const to = vfdaEmails();
  if (!to.length) return { sentTo: [], error: "REPORT_TO_VFDA isn't set." };
  const sentTo: string[] = [];
  for (const address of to) {
    const error = await tryTwice(() =>
      sendEmail(
        address,
        "VFDA VA Quiz App – test email",
        `<p>Test email from the VFDA VA Quiz App. Attempt reports will come from this address.</p><p><a href="${appUrl()}/admin">Open the app</a></p>`,
        `Test email from the VFDA VA Quiz App. Attempt reports will come from this address.\n\n${appUrl()}/admin`,
        `test-${address}-${Date.now()}`,
      ),
    );
    if (error) return { sentTo, error: `${address}: ${error}` };
    sentTo.push(address);
  }
  return { sentTo, error: null };
}

export const sendTestSlack = () =>
  tryTwice(() => postSlack({ text: `Test post from the VFDA VA Quiz App. Attempt reports will appear here. <${appUrl()}/admin|Open the app>` }));

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export async function sendAttemptReport(attemptId: string): Promise<{ sent: number; failed: number }> {
  const db = createAdminClient();
  const loaded = await loadAttemptReport(db, attemptId);
  if (!loaded) return { sent: 0, failed: 0 };
  const { report, doctorEmails } = loaded;
  const subject = reportSections(report).subject;
  const vfda = [...new Set(vfdaEmails().map((e) => e.toLowerCase()))];
  const doctors = [...new Set(doctorEmails.map((e) => e.toLowerCase()))].filter((e) => !vfda.includes(e));

  // VFDA's link opens the admin review page, the doctor's the read-only one.
  const email = (to: string, area: "admin" | "doctor") => {
    const link = attemptLink(attemptId, area);
    return {
      channel: "email" as const,
      recipient: to,
      send: () => sendEmail(to, subject, reportHtml(report, link), reportText(report, link), `attempt-${attemptId}-${to}`),
    };
  };
  const targets: { channel: "email" | "slack"; recipient: string; send: () => Promise<void> }[] = [
    ...vfda.map((to) => email(to, "admin")),
    ...doctors.map((to) => email(to, "doctor")),
    { channel: "slack", recipient: SLACK_RECIPIENT, send: () => postSlack(reportSlack(report, attemptLink(attemptId, "admin"))) },
  ];

  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    await db
      .from("notifications")
      .upsert(
        { attempt_id: attemptId, channel: t.channel, recipient: t.recipient },
        { onConflict: "attempt_id,channel,recipient", ignoreDuplicates: true },
      );
    const { data: row } = await db
      .from("notifications")
      .select("id, sent_at, attempts")
      .eq("attempt_id", attemptId)
      .eq("channel", t.channel)
      .eq("recipient", t.recipient)
      .maybeSingle();
    if (!row || row.sent_at) continue;
    // Claim this try, so two senders running at once don't both send.
    const { data: claimed } = await db
      .from("notifications")
      .update({ attempts: row.attempts + 1, status: "pending" })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .is("sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const error = await tryTwice(t.send);
    if (error === null) {
      await db.from("notifications").update({ sent_at: new Date().toISOString(), status: "sent", error: null }).eq("id", row.id);
      sent++;
    } else {
      console.error("Report not sent", attemptId, t.channel, error);
      await db.from("notifications").update({ status: "failed", error: error.slice(0, 500) }).eq("id", row.id);
      failed++;
    }
  }
  return { sent, failed };
}

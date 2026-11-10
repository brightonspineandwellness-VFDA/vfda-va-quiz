import "server-only";

// Sends the results report after every attempt: the quiz report PDF
// (src/lib/quiz-reports.ts) attached to an email (Resend, from
// REPORT_FROM_EMAIL, reply-to REPORT_REPLY_TO) to VFDA (VFDA_REPORT_EMAIL), a
// Slack post to VFDA (SLACK_WEBHOOK_URL) with the links, and one Leads4Life
// POST (LEADS4LIFE_WEBHOOK_URL) per doctor of the office, which delivers it to
// the doctor. A critical error is also sent at once, while the VA keeps going.
// One notifications row per recipient is written before sending, so running
// this again only sends what hasn't gone out yet. Each send is tried twice.

import { passPercent } from "@/lib/certification";
import { reportFileName, type Leads4LifePayload } from "@/lib/quiz-report";
import { ensureQuizReport, sampleQuizReportLink, type StoredQuizReport } from "@/lib/quiz-reports";
import { loadRetakeComparison } from "@/lib/retake";
import {
  criticalAlertText,
  escapeHtml,
  reportHtml,
  reportSections,
  reportSlack,
  reportText,
  slackEscape,
  criticalCount,
  flagsText,
  workflowStatus,
  type AttemptReport,
  type ReportItem,
} from "@/lib/report";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeScope, scopeText } from "@/lib/va-scope";
import { attemptLabel, percentOf, RESULT_LABELS, sinceStartText, todayIn, trend, withOverride, type ResultLabel } from "@/lib/va-flow";

const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";

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

// Every doctor of the office gets the reports and alerts (VFDA's addresses
// aren't repeated); the Primary doctor's name is shown on them.
export async function officeDoctors(db: Db, officeId: string | null) {
  if (!officeId) return { emails: [] as string[], list: [] as { email: string; name: string }[], primary: null as string | null };
  const [office, doctors] = await Promise.all([
    db.from("offices").select("primary_doctor_id").eq("id", officeId).maybeSingle(),
    db.from("profiles").select("id, full_name, email").eq("office_id", officeId).eq("role", "doctor").is("deactivated_at", null),
  ]);
  const rows = (must(doctors) ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const vfda = vfdaEmails().map((e) => e.toLowerCase());
  const primary = rows.find((d) => d.id === must(office)?.primary_doctor_id);
  const emails = [...new Set(rows.map((d) => d.email?.toLowerCase()).filter((e): e is string => !!e))].filter((e) => !vfda.includes(e));
  return {
    emails,
    // Each doctor's address and name.
    list: emails.map((email) => {
      const d = rows.find((r) => r.email?.toLowerCase() === email);
      return { email, name: d?.full_name?.trim() || email };
    }),
    primary: primary ? primary.full_name?.trim() || primary.email : null,
  };
}

type Feedback = { missed_steps?: string[] } | null;

// Time spent answering vs. the typical time (saved when the quiz is finished).
// Null for older attempts, or before quiz-report-alerts.sql has been run.
async function attemptTimes(db: Db, attemptId: string) {
  const { data, error } = await db.from("attempts").select("answer_time, typical_time").eq("id", attemptId).maybeSingle();
  if (error || !data) return { answerTime: null, typicalTime: null };
  return { answerTime: data.answer_time as number | null, typicalTime: data.typical_time as number | null };
}

export async function loadAttemptReport(db: Db, attemptId: string) {
  const attempt = must(
    await db
      .from("attempts")
      .select("id, va_id, office_id, schedule_day, version, kind, certification_id, first_try_points, max_points, result, time_spent, paste_log, fast_finish, submitted_at")
      .eq("id", attemptId)
      .maybeSingle(),
  );
  // Older attempts labeled pass / review / retake are relabeled by the SQL.
  if (!attempt?.submitted_at || !attempt.result || !(attempt.result in RESULT_LABELS)) return null;

  const [va, office, day, doctors, attempts, workflows, grayWorkflows, certifications] = await Promise.all([
    db.from("profiles").select("full_name, email, va_start_date, va_scope").eq("id", attempt.va_id).maybeSingle(),
    db.from("offices").select("name").eq("id", attempt.office_id).maybeSingle(),
    db.from("schedule_days").select("title").eq("code", attempt.schedule_day).maybeSingle(),
    officeDoctors(db, attempt.office_id),
    db
      .from("attempts")
      .select("id, kind, first_try_points, max_points, submitted_at")
      .eq("va_id", attempt.va_id)
      .eq("office_id", attempt.office_id)
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at"),
    db.from("workflows").select("code, name, pass_standard"),
    db.from("office_workflows").select("id, code, name, card_answers").eq("office_id", attempt.office_id),
    db.from("certifications").select("id, workflow, office_workflow_id, status, sop_status, sop_submitted_at").eq("va_id", attempt.va_id).eq("office_id", attempt.office_id),
  ]);

  // Every graded item of this VA so far: this attempt's for the report, all of
  // them for the workflow statuses.
  const attemptRows = must(attempts) ?? [];
  const attemptIds = attemptRows.map((a) => a.id);
  // First-try % of each training day up to this one.
  const dayPercents = attemptRows
    .filter((a) => a.kind === "day" && a.submitted_at! <= attempt.submitted_at!)
    .map((a) => percentOf(a.first_try_points, a.max_points));
  const allItems =
    must(
      await db
        .from("attempt_items")
        .select(
          "attempt_id, office_scenario_id, first_score, first_feedback, repeat_scenario_id, repeat_score, critical_error, critical_quote, ai_confidence, vfda_override, fast, position, paste_log",
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
      low_confidence: s.type !== "mc" && i.ai_confidence !== null && i.ai_confidence < LOW_CONFIDENCE,
      overridden: !!row.vfda_override,
    };
  };
  const mine = allItems
    .filter((i) => i.attempt_id === attemptId)
    .sort((a, b) => a.position - b.position)
    .map(toItem)
    .filter((i): i is ReportItem => !!i);

  const names = new Map<string, string>((must(workflows) ?? []).map((w) => [w.code, w.name]));
  const standards = new Map<string, string | null>((must(workflows) ?? []).map((w) => [w.code, w.pass_standard]));
  const grayIds = new Map<string, string>();
  for (const g of must(grayWorkflows) ?? []) {
    names.set(g.code, g.name || String((g.card_answers as Record<string, unknown>)?.CARD_NAME ?? g.code));
    grayIds.set(g.code, g.id);
  }
  const certs = must(certifications) ?? [];
  const certOf = (code: string) =>
    certs.find((c) => (grayIds.has(code) ? c.office_workflow_id === grayIds.get(code) : c.workflow === code)) ?? null;
  // A retrain or recheck is reported under its workflow; a retake under its
  // day, next to its first try.
  const drill = attempt.kind === "retrain" || attempt.kind === "recheck" ? (attempt.kind as "retrain" | "recheck") : null;
  const retake = attempt.kind === "retake" ? await loadRetakeComparison(db, attempt.id) : null;
  const percents = drill ? [percentOf(attempt.first_try_points, attempt.max_points)] : dayPercents;
  const drillWorkflow = drill ? (mine[0]?.workflow ?? "") : "";
  const dayWorkflows = [...new Set(mine.map((i) => i.workflow))].sort();
  // Workflow statuses are first-try evidence: retakes don't count.
  const retakeIds = new Set(attemptRows.filter((a) => a.kind === "retake").map((a) => a.id));
  const everything = allItems
    .filter((i) => !retakeIds.has(i.attempt_id))
    .map(toItem)
    .filter((i): i is ReportItem => !!i);

  const report: AttemptReport = {
    vaName: must(va)?.full_name || must(va)?.email || "VA",
    officeName: must(office)?.name ?? "Office",
    dayCode: drill ? `${drill === "retrain" ? "Retrain" : "Recheck"} ${drillWorkflow}` : attempt.schedule_day,
    dayTitle: drill ? (names.get(drillWorkflow) ?? drillWorkflow) : (must(day)?.title ?? ""),
    points: Number(attempt.first_try_points ?? 0),
    maxPoints: attempt.max_points ?? 0,
    result: attempt.result as ResultLabel,
    trend: { direction: trend(percents), percents },
    timeSpent: attempt.time_spent,
    fastFinish: attempt.fast_finish,
    pastes: Array.isArray(attempt.paste_log) ? attempt.paste_log.length : 0,
    pastedAnswers: allItems.filter((i) => i.attempt_id === attemptId && Array.isArray(i.paste_log) && i.paste_log.length > 0).length,
    ...(await attemptTimes(db, attemptId)),
    sinceStart: sinceStartText(must(va)?.va_start_date, todayIn(TIME_ZONE, new Date(attempt.submitted_at))),
    primaryDoctor: doctors.primary ?? undefined,
    scope: scopeText(normalizeScope(must(va)?.va_scope)),
    ...(retake ? { retake } : {}),
    items: mine,
    workflows: dayWorkflows.map((code) => ({
      code,
      name: names.get(code) ?? code,
      ...workflowStatus(
        everything.filter((i) => i.workflow === code),
        certOf(code),
        passPercent(standards.get(code)),
      ),
    })),
  };
  return { report, doctorEmails: doctors.emails, doctors: doctors.list };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  idempotencyKey: string,
  attachments: { filename: string; content: string }[] = [], // content: base64
) {
  const key = process.env.RESEND_API_KEY;
  const from = reportFrom();
  if (!key || !from) throw new Error("Email isn't set up: RESEND_API_KEY and REPORT_FROM_EMAIL are needed.");
  const replyTo = process.env.REPORT_REPLY_TO?.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments.length ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Resend answered ${res.status}${body?.message ? `: ${body.message}` : ""}`);
  }
}

// One POST to Leads4Life, which delivers the report to the doctor.
export async function postLeads4Life(payload: Leads4LifePayload, idempotencyKey: string) {
  const url = process.env.LEADS4LIFE_WEBHOOK_URL?.trim();
  if (!url) throw new Error("Leads4Life isn't set up: LEADS4LIFE_WEBHOOK_URL is needed.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Leads4Life answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

export async function postSlack(payload: { text: string }) {
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
export async function tryTwice(send: () => Promise<void>): Promise<string | null> {
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

export const reportFrom = () => (process.env.REPORT_FROM_EMAIL ?? "").trim();

export const vfdaEmails = () =>
  (process.env.VFDA_REPORT_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));

// The Slack row's recipient. The webhook URL itself is a secret and is never stored.
export const SLACK_RECIPIENT = "VFDA Slack";
// Leads4Life rows: channel "leads4life", recipient the doctor's email.
export const LEADS4LIFE = "leads4life";

// ---------------------------------------------------------------------------
// Test buttons (/admin/settings)
// ---------------------------------------------------------------------------

export async function sendTestEmail(): Promise<{ sentTo: string[]; error: string | null }> {
  const to = vfdaEmails();
  if (!to.length) return { sentTo: [], error: "VFDA_REPORT_EMAIL isn't set." };
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

// A sample payload, as Leads4Life will get it, with a real signed link to a
// sample PDF. Sent once (no retry), so the answer shown is Leads4Life's own.
export async function sendTestLeads4Life(): Promise<{ status: number | null; text: string; error: string | null }> {
  const url = process.env.LEADS4LIFE_WEBHOOK_URL?.trim();
  if (!url) return { status: null, text: "", error: "LEADS4LIFE_WEBHOOK_URL isn't set." };
  let link: string;
  try {
    link = await sampleQuizReportLink(createAdminClient());
  } catch (e) {
    return { status: null, text: "", error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `test-${Date.now()}` },
      body: JSON.stringify({
        doctor_email: "brightonspineandwellness+doctortest@gmail.com",
        doctor_name: "Dr. Test",
        office: "Test Office",
        va_name: "Test VA",
        day: "W1D1",
        topic: "Basics & VA Onboarding",
        result: "Needs coaching",
        first_try_score: "72%",
        is_retake: "no",
        report_link: link,
        // Matches the sample PDF.
        critical_errors: 1,
        flags: "fast finish, 3 pasted answers",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, text: `${res.status} ${res.statusText}`.trim() + `: ${(await res.text().catch(() => "")).slice(0, 200)}`, error: null };
  } catch (e) {
    return { status: null, text: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export const sendTestSlack = () =>
  tryTwice(() => postSlack({ text: `Test post from the VFDA VA Quiz App. Attempt reports will appear here. <${appUrl()}/admin|Open the app>` }));

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type Target = { channel: "email" | "slack" | "leads4life"; recipient: string; send: () => Promise<void> };

// One notifications row per recipient, written before sending, so running
// this again only sends what hasn't gone out yet. `key` picks the report
// (an attempt, a certification event, or a reminder to a VA).
export async function deliver(
  db: Db,
  key: { attempt_id: string; event: string } | { certification_id: string; event: string } | { va_id: string; event: string },
  targets: Target[],
): Promise<{ sent: number; failed: number }> {
  const onConflict = `${"attempt_id" in key ? "attempt_id" : "certification_id" in key ? "certification_id" : "va_id"},event,channel,recipient`;
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    const { error: upsertError } = await db
      .from("notifications")
      .upsert({ ...key, channel: t.channel, recipient: t.recipient }, { onConflict, ignoreDuplicates: true });
    if (upsertError) throw new Error(upsertError.message);
    const { data: row } = await db
      .from("notifications")
      .select("id, sent_at, attempts")
      .match({ ...key, channel: t.channel, recipient: t.recipient })
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
      console.error("Not sent", key, t.channel, error);
      await db.from("notifications").update({ status: "failed", error: error.slice(0, 500) }).eq("id", row.id);
      failed++;
    }
  }
  return { sent, failed };
}

// The attempt's PDF, made (and stored) once. Null when it couldn't be made:
// the VFDA email and Slack still go out, and Leads4Life waits for "Resend".
async function attemptPdf(db: Db, attemptId: string, report: AttemptReport, regenerate = false) {
  try {
    return { pdf: await ensureQuizReport(db, attemptId, report, regenerate), error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("Quiz report PDF not made", attemptId, error);
    return { pdf: null as StoredQuizReport | null, error };
  }
}

// `regenerate`: make the PDF again (an attempt that already has one).
// `again`: "Send report" on the admin attempt page; everything is sent again
// as a new send (event again:<time>), whatever went out before.
export async function sendAttemptReport(
  attemptId: string,
  opts: { regenerate?: boolean; again?: string } = {},
): Promise<{ sent: number; failed: number }> {
  const db = createAdminClient();
  const loaded = await loadAttemptReport(db, attemptId);
  if (!loaded) return { sent: 0, failed: 0 };
  const { report, doctors } = loaded;
  const subject = reportSections(report).subject;
  const vfda = [...new Set(vfdaEmails().map((e) => e.toLowerCase()))];
  const { pdf, error: pdfError } = await attemptPdf(db, attemptId, report, !!opts.regenerate);
  // Each send gets its own idempotency key, so Resend and Leads4Life don't drop it as a repeat.
  const keySuffix = opts.again ? `-again-${opts.again}` : "";
  const link = attemptLink(attemptId, "admin");
  const pdfNote = pdf ? "" : `The report PDF couldn't be made (${pdfError}). Download it from the attempt page.`;
  const attachments = pdf ? [{ filename: reportFileName({ ...report, retake: !!report.retake }), content: Buffer.from(pdf.bytes).toString("base64") }] : [];
  const percent = report.maxPoints ? Math.round((report.points * 100) / report.maxPoints) : 0;

  // VFDA: the email with the PDF attached, and Slack with both links.
  const email = (to: string): Target => ({
    channel: "email",
    recipient: to,
    send: () =>
      sendEmail(
        to,
        subject,
        reportHtml(report, link) + (pdfNote ? `<p style="color:#9b1c1c">${escapeHtml(pdfNote)}</p>` : ""),
        reportText(report, link) + (pdfNote ? `\n\n${pdfNote}` : ""),
        `attempt-${attemptId}-${to}${keySuffix}`,
        attachments,
      ),
  });
  const slack = reportSlack(report, link);
  // Each doctor: one Leads4Life POST with the PDF's 30-day link.
  const leads4life = (d: { email: string; name: string }): Target => ({
    channel: LEADS4LIFE,
    recipient: d.email,
    send: async () => {
      // Made again here when it failed before, so "Resend" can fix it.
      const stored = pdf ?? (await ensureQuizReport(db, attemptId, report));
      await postLeads4Life(
        {
          doctor_email: d.email,
          doctor_name: d.name,
          office: report.officeName,
          va_name: report.vaName,
          day: report.dayCode,
          topic: report.dayTitle,
          result: RESULT_LABELS[report.result],
          first_try_score: percent,
          is_retake: !!report.retake,
          report_link: stored.link,
          critical_errors: criticalCount(report),
          flags: flagsText(report),
        },
        `attempt-${attemptId}-${d.email}${keySuffix}`,
      );
    },
  });
  return deliver(db, { attempt_id: attemptId, event: opts.again ? `again:${opts.again}` : "" }, [
    ...vfda.map(email),
    {
      channel: "slack",
      recipient: SLACK_RECIPIENT,
      send: () => postSlack({ text: pdf ? `${slack.text}\n<${pdf.link}|Report PDF> (link valid 30 days)` : slack.text }),
    },
    ...doctors.map(leads4life),
  ]);
}

// ---------------------------------------------------------------------------
// A critical error: sent at once to VFDA and every doctor of the office, with the
// VA's exact words. The VA keeps going.
// ---------------------------------------------------------------------------

export async function sendCriticalAlert(itemId: string, phase: "first" | "repeat"): Promise<{ sent: number; failed: number }> {
  const db = createAdminClient();
  const item = must(
    await db
      .from("attempt_items")
      .select("id, attempt_id, office_scenario_id, repeat_scenario_id, critical_quote")
      .eq("id", itemId)
      .maybeSingle(),
  );
  if (!item?.critical_quote) return { sent: 0, failed: 0 };
  const attempt = must(await db.from("attempts").select("id, va_id, office_id, schedule_day, kind").eq("id", item.attempt_id).single()) as {
    id: string;
    va_id: string;
    office_id: string;
    schedule_day: string;
    kind: string;
  };
  const shownId = phase === "repeat" && item.repeat_scenario_id ? item.repeat_scenario_id : item.office_scenario_id;
  const [va, office, scenario, doctors] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", attempt.va_id).maybeSingle(),
    db.from("offices").select("name").eq("id", attempt.office_id).maybeSingle(),
    db.from("office_scenarios").select("code, workflow, stem").eq("id", shownId).maybeSingle(),
    officeDoctors(db, attempt.office_id),
  ]);
  const s = must(scenario);
  const { subject, lines } = criticalAlertText({
    vaName: (must(va)?.full_name || must(va)?.email || "VA") as string,
    officeName: (must(office)?.name ?? "Office") as string,
    dayCode: attemptLabel(attempt),
    code: s?.code ?? "",
    workflow: s?.workflow ?? "",
    repeat: phase === "repeat",
    stem: s?.stem ?? "",
    quote: item.critical_quote,
    primaryDoctor: doctors.primary,
  });
  const vfda = [...new Set(vfdaEmails().map((e) => e.toLowerCase()))];
  const doctorEmails = doctors.emails;
  const event = `critical-${phase}:${item.id}`;
  const email = (to: string, area: "admin" | "doctor"): Target => {
    const link = attemptLink(attempt.id, area);
    return {
      channel: "email",
      recipient: to,
      send: () =>
        sendEmail(
          to,
          subject,
          `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines
            .map((l) => `<p>${escapeHtml(l)}</p>`)
            .join("")}<p><a href="${escapeHtml(link)}">Open the attempt</a> (login required)</p></div>`,
          `${lines.join("\n\n")}\n\nOpen the attempt (login required): ${link}`,
          `${event}-${to}`,
        ),
    };
  };
  return deliver(db, { attempt_id: attempt.id, event }, [
    ...vfda.map((to) => email(to, "admin")),
    ...doctorEmails.map((to) => email(to, "doctor")),
    {
      channel: "slack",
      recipient: SLACK_RECIPIENT,
      send: () =>
        postSlack({
          text: [`:rotating_light: *${slackEscape(subject)}*`, ...lines.map(slackEscape), `<${attemptLink(attempt.id, "admin")}|Open the attempt>`].join("\n"),
        }),
    },
  ]);
}

// ---------------------------------------------------------------------------
// A VA marked a day's cards done, but VFDA hasn't approved that day for the
// office yet. Sent once per VA and day (day_unlocks.prep_notified_at).
// ---------------------------------------------------------------------------

export async function sendPreparingNotice(vaId: string, day: string): Promise<{ failed: number }> {
  const db = createAdminClient();
  const va = must(await db.from("profiles").select("full_name, email, office_id").eq("id", vaId).maybeSingle());
  if (!va?.office_id) return { failed: 0 };
  const office = must(await db.from("offices").select("name").eq("id", va.office_id).maybeSingle());
  const vaName = (va.full_name || va.email || "VA") as string;
  const officeName = (office?.name ?? "Office") as string;
  const link = `${appUrl()}/admin/offices/${va.office_id}/scenarios/${day}`;
  const subject = `Quiz needed: ${day} for ${officeName} – ${vaName} is waiting`;
  const line = `${vaName} (${officeName}) finished today's cards for ${day}, but ${day} isn't approved for the office yet. Approve its scenarios so the quiz opens.`;
  let failed = 0;
  for (const to of [...new Set(vfdaEmails().map((e) => e.toLowerCase()))]) {
    const error = await tryTwice(() =>
      sendEmail(
        to,
        subject,
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111"><p>${escapeHtml(line)}</p><p><a href="${escapeHtml(link)}">Open ${day}</a> (login required)</p></div>`,
        `${line}\n\nOpen ${day} (login required): ${link}`,
        `preparing-${vaId}-${day}-${to}`,
      ),
    );
    if (error) {
      console.error("Not sent", subject, to, error);
      failed++;
    }
  }
  const slackError = await tryTwice(() => postSlack({ text: `*${slackEscape(subject)}*\n${slackEscape(line)}\n<${link}|Open ${day}>` }));
  if (slackError) {
    console.error("Not sent", subject, "slack", slackError);
    failed++;
  }
  return { failed };
}

// ---------------------------------------------------------------------------
// SOP notices: a Trello card link submitted, and each status VFDA sets.
// VFDA gets an email and a Slack post; on a submit, the doctor gets an email
// asking them to review the card on Trello.
// ---------------------------------------------------------------------------

export type SopEvent = "submitted" | "approved" | "needs_changes" | "rejected";

const SOP_EVENT_TEXT: Record<SopEvent, string> = {
  submitted: "Trello card updated",
  approved: "Doctor approved on Trello",
  needs_changes: "Needs changes",
  rejected: "Rejected (coaching needed)",
};

export async function sendSopNotice(certificationId: string, event: SopEvent): Promise<{ sent: number; failed: number }> {
  const db = createAdminClient();
  const cert = must(
    await db
      .from("certifications")
      .select("id, va_id, office_id, workflow, office_workflow_id, sop_links, sop_status, sop_note, sop_submitted_at, sop_confirmed_at")
      .eq("id", certificationId)
      .maybeSingle(),
  );
  if (!cert) return { sent: 0, failed: 0 };
  const va = must(await db.from("profiles").select("full_name, email").eq("id", cert.va_id).maybeSingle());
  const officeId = cert.office_id as string | null;
  const [office, workflow, gray, doctors] = await Promise.all([
    officeId ? db.from("offices").select("name").eq("id", officeId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    cert.workflow ? db.from("workflows").select("code, name").eq("code", cert.workflow).maybeSingle() : Promise.resolve({ data: null, error: null }),
    cert.office_workflow_id
      ? db.from("office_workflows").select("code, name, card_answers").eq("id", cert.office_workflow_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    officeDoctors(db, officeId),
  ]);
  const g = must(gray) as { code: string; name: string | null; card_answers: Record<string, unknown> | null } | null;
  const wf = must(workflow) as { code: string; name: string } | null;
  const code = wf?.code ?? g?.code ?? "";
  const name = wf?.name ?? (g?.name || String(g?.card_answers?.CARD_NAME ?? code));
  const vaName = (va?.full_name || va?.email || "VA") as string;
  const officeName = ((must(office) as { name: string } | null)?.name ?? "Office") as string;
  const links = (cert.sop_links as string[]) ?? [];
  const note = (cert.sop_note as string | null)?.trim() || "";
  const subject = `${vaName} – SOP ${code} ${name} – ${SOP_EVENT_TEXT[event]} – ${officeName}`;
  const when = event === "submitted" ? cert.sop_submitted_at : cert.sop_confirmed_at;
  const eventKey = `sop-${event}:${when ?? ""}`;

  // Every SOP notice goes to every doctor of the office too.
  const lines = (audience: "vfda" | "doctor") => [
    audience === "doctor"
      ? event === "submitted"
        ? `${vaName} updated your office's Trello card for ${code} ${name}. Please review it on Trello and approve it there, or comment on the card with what to change. VFDA confirms your approval in the app.`
        : `${vaName}'s Trello card for ${code} ${name}: ${SOP_EVENT_TEXT[event]} (confirmed by VFDA).`
      : `${vaName} (${officeName}${doctors.primary ? `, Primary doctor ${doctors.primary}` : ""}): ${code} ${name}. ${SOP_EVENT_TEXT[event]}.`,
    ...links.map((l) => `Trello card: ${l}`),
    ...(note && event !== "submitted" ? [`Note: ${note}`] : []),
  ];
  const html = (audience: "vfda" | "doctor", link: string) =>
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines(audience)
      .map((l) => {
        const m = /^Trello card: (.*)$/.exec(l);
        return m ? `<p>Trello card: <a href="${escapeHtml(m[1])}">${escapeHtml(m[1])}</a></p>` : `<p>${escapeHtml(l)}</p>`;
      })
      .join("")}<p><a href="${escapeHtml(link)}">Open in the app</a> (login required)</p></div>`;
  const text = (audience: "vfda" | "doctor", link: string) => `${lines(audience).join("\n\n")}\n\nOpen in the app (login required): ${link}`;

  const vfda = [...new Set(vfdaEmails().map((e) => e.toLowerCase()))];
  const doctorEmails = doctors.emails;
  const adminLink = `${appUrl()}/admin/sops`;
  const doctorLink = `${appUrl()}/doctor/va`;
  const email = (to: string, audience: "vfda" | "doctor"): Target => {
    const link = audience === "vfda" ? adminLink : doctorLink;
    return {
      channel: "email",
      recipient: to,
      send: () => sendEmail(to, subject, html(audience, link), text(audience, link), `${certificationId}-${eventKey}-${to}`),
    };
  };
  return deliver(db, { certification_id: certificationId, event: eventKey }, [
    ...vfda.map((to) => email(to, "vfda")),
    ...doctorEmails.map((to) => email(to, "doctor")),
    {
      channel: "slack",
      recipient: SLACK_RECIPIENT,
      send: () =>
        postSlack({
          text: [`*${slackEscape(subject)}*`, ...lines("vfda").slice(1).map(slackEscape), `<${adminLink}|SOPs to confirm>`].join("\n"),
        }),
    },
  ]);
}

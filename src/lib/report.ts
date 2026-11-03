// The results report sent after every attempt (SPEC section 6, Reports), as
// pure functions: what goes in it and how it reads as an email (text + HTML)
// and a Slack post. An At risk day reads as an alert. src/lib/reports.ts
// loads the data and sends it.

import { RESULT_LABELS, type ResultLabel, type Trend } from "@/lib/va-flow";

export type ReportItem = {
  code: string;
  workflow: string;
  type: "mc" | "situational";
  points: number;
  first_score: number | null;
  repeat_score: number | null;
  repeated: boolean;
  missed_steps: string[];
  critical_error: boolean;
  critical_quote: string | null;
  fast: boolean;
  low_confidence: boolean;
  overridden: boolean;
};

export type WorkflowStatus = { code: string; name: string; status: "Certified" | "Coaching needed" | "Pending"; why: string };

export type AttemptReport = {
  vaName: string;
  officeName: string;
  dayCode: string;
  dayTitle: string;
  points: number;
  maxPoints: number;
  result: ResultLabel;
  // First-try % per day so far, oldest first (this one last), and where it's heading.
  trend: { direction: Trend | null; percents: number[] };
  timeSpent: number | null; // seconds
  fastFinish: boolean;
  pastes: number;
  items: ReportItem[];
  workflows: WorkflowStatus[];
};

export const TREND_LABELS: Record<Trend, string> = { improving: "Improving", flat: "Flat", declining: "Declining" };

export function trendText(t: AttemptReport["trend"]) {
  if (!t.direction) return "first day, no trend yet";
  return `${TREND_LABELS[t.direction]} (${t.percents.slice(-5).map((p) => `${p}%`).join(" → ")})`;
}

const score = (n: number | null, max: number) => (n === null ? "ungraded" : `${n}/${max}`);

export function minutesText(seconds: number | null) {
  if (seconds === null) return "unknown";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// What the report says, in order. Every channel renders these sections.
export function reportSections(r: AttemptReport) {
  const repeated = r.items.filter((i) => i.repeated);
  const critical = r.items.filter((i) => i.critical_error);
  // Weakest: lowest share of points on the first try, among items that lost points.
  const weakest = r.items
    .filter((i) => (i.first_score ?? 0) < i.points)
    .sort((a, b) => (a.first_score ?? 0) / a.points - (b.first_score ?? 0) / b.points || b.points - a.points)
    .slice(0, 3);
  const flags = [
    r.fastFinish && "finished much faster than normal",
    r.items.some((i) => i.fast) && `${r.items.filter((i) => i.fast).length} item(s) answered much faster than normal`,
    r.pastes > 0 && `${r.pastes} paste(s) logged`,
    r.items.some((i) => i.type === "situational" && i.first_score === null) && "an answer couldn't be graded automatically (needs review)",
    r.items.some((i) => i.low_confidence) && "a low-confidence grade (VFDA reviews)",
    r.items.some((i) => i.overridden) && "a score was changed by VFDA",
  ].filter((f): f is string => !!f);
  const percent = r.maxPoints ? Math.round((r.points * 100) / r.maxPoints) : 0;
  // At risk (or any critical error) is an alert: VFDA coaches, the VA keeps going.
  const alert = r.result === "at_risk" ? "ALERT: " : "";

  return {
    alert: !!alert,
    subject: `${alert}${r.vaName} – ${r.dayCode} – ${RESULT_LABELS[r.result]} – ${r.officeName}`,
    summary: [
      ["VA", r.vaName],
      ["Office", r.officeName],
      ["Day", `${r.dayCode}: ${r.dayTitle}`],
      ["Result", RESULT_LABELS[r.result]],
      ["First-try score", `${r.points}/${r.maxPoints} (${percent}%)`],
      ["Trend", trendText(r.trend)],
      ["Time spent", minutesText(r.timeSpent)],
    ] as [string, string][],
    repeated: repeated.map(
      (i) =>
        `${i.code}: ${score(i.first_score, i.points)} first try, ${score(i.repeat_score, i.points)} on repeat${
          i.repeat_score === 2 ? " (learned from the feedback)" : i.repeat_score !== null ? " (still below 2/2)" : ""
        }`,
    ),
    critical: critical.map((i) => `${i.code}: "${i.critical_quote ?? ""}"`),
    weakest: weakest.map((i) => ({
      title: `${i.code} (${i.workflow}): ${score(i.first_score, i.points)}`,
      missed: i.missed_steps,
    })),
    workflows: r.workflows.map((w) => `${w.code} ${w.name}: ${w.status}${w.why ? ` (${w.why})` : ""}`),
    flags,
  };
}

const NONE = "None";
const ALERT_LINE = "ALERT: At risk. Please coach this VA; they keep going with their training.";

// `link`: the attempt review page (login required).
export function reportText(r: AttemptReport, link: string): string {
  const s = reportSections(r);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : NONE);
  return [
    s.summary.map(([k, v]) => `${k}: ${v}`).join("\n"),
    s.alert ? ALERT_LINE : "",
    `Items repeated (repeat scores):\n${list(s.repeated)}`,
    `Critical errors (VA's exact words):\n${list(s.critical)}`,
    `Weakest items:\n${
      s.weakest.length
        ? s.weakest.map((w) => `- ${w.title}${w.missed.length ? `\n${w.missed.map((m) => `    missed: ${m}`).join("\n")}` : ""}`).join("\n")
        : NONE
    }`,
    `Workflow statuses:\n${list(s.workflows)}`,
    s.flags.length ? `Flags:\n${list(s.flags)}` : "",
    `Review the attempt (login required): ${link}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function reportHtml(r: AttemptReport, link: string): string {
  const s = reportSections(r);
  const e = escapeHtml;
  const h = (t: string) => `<h3 style="margin:20px 0 6px;font-size:15px">${e(t)}</h3>`;
  const list = (items: string[]) =>
    items.length ? `<ul style="margin:0;padding-left:20px">${items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>` : `<p style="margin:0">${NONE}</p>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">
${s.alert ? `<p style="margin:0 0 12px;padding:8px 12px;background:#fde8e8;color:#9b1c1c;font-weight:bold">${e(ALERT_LINE)}</p>` : ""}
<table style="border-collapse:collapse">${s.summary
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${e(k)}</td><td style="padding:2px 0"><b>${e(v)}</b></td></tr>`)
    .join("")}</table>
${h("Items repeated (repeat scores)")}${list(s.repeated)}
${h("Critical errors (VA's exact words)")}${list(s.critical)}
${h("Weakest items")}${
    s.weakest.length
      ? `<ul style="margin:0;padding-left:20px">${s.weakest
          .map((w) => `<li>${e(w.title)}${w.missed.length ? `<ul>${w.missed.map((m) => `<li>Missed: ${e(m)}</li>`).join("")}</ul>` : ""}</li>`)
          .join("")}</ul>`
      : `<p style="margin:0">${NONE}</p>`
  }
${h("Workflow statuses")}${list(s.workflows)}
${s.flags.length ? `${h("Flags")}${list(s.flags)}` : ""}
<p style="margin-top:20px"><a href="${e(link)}">Review the attempt</a> (login required)</p>
<p style="margin-top:24px;color:#777;font-size:12px">VFDA VA Quiz App. Practice scenarios use fake patients only.</p>
</div>`;
}

// Slack mrkdwn: escape &, < and > so a VA's words can't ping or link anyone.
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The same summary in short form.
export function reportSlack(r: AttemptReport, link: string): { text: string } {
  const s = reportSections(r);
  const line = (label: string, items: string[]) => (items.length ? `*${label}:* ${items.map(slackEscape).join(" · ")}` : "");
  const lines = [
    `${s.alert ? ":rotating_light: " : ""}*${slackEscape(s.subject)}*`,
    `${RESULT_LABELS[r.result]} · first try ${r.points}/${r.maxPoints} · trend: ${slackEscape(trendText(r.trend))} · ${minutesText(r.timeSpent)}`,
    line("Repeated", s.repeated),
    line("Critical (VA's words)", s.critical),
    line(
      "Weakest",
      s.weakest.map((w) => (w.missed.length ? `${w.title} (missed: ${w.missed.join("; ")})` : w.title)),
    ),
    line("Workflows", s.workflows),
    line("Flags", s.flags),
    `<${link}|Review the attempt>`,
  ];
  return { text: lines.filter(Boolean).join("\n") };
}

// The workflow's certification status (src/lib/certifications.ts works it
// out on the server), with a short reason. No certification row yet: the
// workflow's last scheduled day hasn't been reached.
export function workflowStatus(
  items: Pick<ReportItem, "type" | "points" | "first_score" | "critical_error">[],
  certification: { status: string; sop_status: string; sop_submitted_at: string | null } | null,
  passPercent = 80,
): Pick<WorkflowStatus, "status" | "why"> {
  if (!certification) return { status: "Pending", why: "later days not reached yet" };
  if (certification.status === "certified") return { status: "Certified", why: "" };
  if (certification.status !== "pending") {
    const graded = items.filter((i) => i.first_score !== null);
    const max = graded.reduce((n, i) => n + i.points, 0);
    const percent = max ? Math.round((graded.reduce((n, i) => n + (i.first_score ?? 0), 0) * 100) / max) : null;
    const why = items.some((i) => i.critical_error)
      ? "critical error"
      : percent !== null && percent < passPercent
        ? `first-try average ${percent}%`
        : certification.sop_status === "rejected"
          ? "SOP rejected"
          : "VFDA decides the follow-up";
    return { status: "Coaching needed", why };
  }
  const why = !certification.sop_submitted_at
    ? "Trello card not updated yet"
    : certification.sop_status === "approved"
      ? "scenarios not all done yet"
      : certification.sop_status === "needs_changes"
        ? "Trello card needs changes"
        : "waiting for VFDA to confirm the Trello card";
  return { status: "Pending", why };
}

// ---------------------------------------------------------------------------
// Immediate alert: a critical error, in the VA's exact words.
// ---------------------------------------------------------------------------

export type CriticalAlert = {
  vaName: string;
  officeName: string;
  dayCode: string;
  code: string;
  workflow: string;
  repeat: boolean;
  stem: string;
  quote: string;
};

export function criticalAlertText(a: CriticalAlert) {
  return {
    subject: `ALERT: critical error – ${a.vaName} – ${a.dayCode} ${a.code} – ${a.officeName}`,
    lines: [
      `${a.vaName} (${a.officeName}) made a critical error on ${a.dayCode} ${a.code} (${a.workflow})${a.repeat ? ", on the repeat" : ""}. They keep going with their training; please coach them.`,
      `Scenario: ${a.stem}`,
      `The VA's exact words: "${a.quote}"`,
    ],
  };
}

// The results report sent after every attempt (SPEC section 6, Reports), as
// pure functions: what goes in it and how it reads as an email (text + HTML)
// and a Slack post. src/lib/reports.ts loads the data and sends it.

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

export type WorkflowStatus = { code: string; name: string; status: "Certified" | "Retrain" | "Pending"; why: string };

export type AttemptReport = {
  vaName: string;
  officeName: string;
  dayCode: string;
  dayTitle: string;
  version: "A" | "B";
  points: number;
  maxPoints: number;
  result: "pass" | "review" | "retake";
  timeSpent: number | null; // seconds
  fastFinish: boolean;
  pastes: number;
  items: ReportItem[];
  workflows: WorkflowStatus[];
};

export const RESULT_LABELS = {
  pass: "Pass",
  review: "Review (VFDA decides)",
  retake: "Retake (version B next training day)",
} as const;

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
  const resultText =
    r.result === "retake" && r.version === "B" ? "Retake failed on version B: set up a call with the VA" : RESULT_LABELS[r.result];

  return {
    subject: `${r.vaName} – ${r.dayCode}${r.version === "B" ? " (B)" : ""} – ${RESULT_LABELS[r.result].split(" (")[0]} – ${r.officeName}`,
    summary: [
      ["VA", r.vaName],
      ["Office", r.officeName],
      ["Day", `${r.dayCode}: ${r.dayTitle}${r.version === "B" ? " (version B, retake)" : ""}`],
      ["First-try score", `${r.points}/${r.maxPoints}`],
      ["Result", resultText],
      ["Time spent", minutesText(r.timeSpent)],
    ] as [string, string][],
    repeated: repeated.map((i) => `${i.code}: ${score(i.first_score, i.points)} first try, ${score(i.repeat_score, i.points)} on repeat`),
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

// `link`: the attempt review page (login required).
export function reportText(r: AttemptReport, link: string): string {
  const s = reportSections(r);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : NONE);
  return [
    s.summary.map(([k, v]) => `${k}: ${v}`).join("\n"),
    `Items repeated:\n${list(s.repeated)}`,
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
<table style="border-collapse:collapse">${s.summary
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${e(k)}</td><td style="padding:2px 0"><b>${e(v)}</b></td></tr>`)
    .join("")}</table>
${h("Items repeated")}${list(s.repeated)}
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
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The same summary in short form.
export function reportSlack(r: AttemptReport, link: string): { text: string } {
  const s = reportSections(r);
  const result = s.summary.find(([k]) => k === "Result")?.[1] ?? "";
  const line = (label: string, items: string[]) => (items.length ? `*${label}:* ${items.map(slackEscape).join(" · ")}` : "");
  const lines = [
    `*${slackEscape(s.subject)}*`,
    `First try ${r.points}/${r.maxPoints} · ${slackEscape(result)} · ${minutesText(r.timeSpent)}`,
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

// SPEC section 6: Retrain on a critical error or an uncorrected repeat;
// Certified needs the doctor's SOP approval too; Pending otherwise.
export function workflowStatus(
  items: Pick<ReportItem, "type" | "first_score" | "repeat_score" | "repeated" | "critical_error">[],
  certification: { status: string; doctor_decision: string | null } | null,
): Pick<WorkflowStatus, "status" | "why"> {
  if (certification?.doctor_decision === "rejected") return { status: "Retrain", why: "SOP rejected" };
  if (items.some((i) => i.critical_error)) return { status: "Retrain", why: "critical error" };
  if (items.some((i) => i.type === "situational" && i.first_score !== null && i.first_score < 2 && i.repeat_score !== 2)) {
    return { status: "Retrain", why: "a missed item wasn't corrected on repeat" };
  }
  if (certification?.status === "certified") return { status: "Certified", why: "" };
  return { status: "Pending", why: certification?.doctor_decision ? "" : "SOP not approved yet" };
}

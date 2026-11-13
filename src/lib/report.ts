// The results report sent after every attempt (SPEC section 6, Reports), as
// pure functions: what goes in it and how it reads as an email (text + HTML)
// and a Slack post. The body follows the quiz report (src/lib/quiz-report.ts):
// what went well first, then things to focus on, important to review, flags.
// src/lib/reports.ts loads the data and sends it.

import { scoreLine, type QuizReport } from "@/lib/quiz-report";
import { retakeLineText, type RetakeComparison } from "@/lib/retake";
import { STANDARDS_NOTICE } from "@/lib/rule-source";
import { RESULT_LABELS, type ResultLabel, type Trend } from "@/lib/va-flow";

export type ReportItem = {
  code: string;
  workflow: string;
  type: "mc" | "situational" | "describe";
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
  // A day the VA retook: the retake's raw score (the first try stays official).
  retakeScore?: { points: number; max: number } | null;
  timeSpent: number | null; // seconds
  fastFinish: boolean;
  pastes: number;
  // Answers with pasted text, and (when known) the time spent answering vs. the typical time, in seconds.
  pastedAnswers?: number;
  answerTime?: number | null;
  typicalTime?: number | null;
  // Days from the VA's start date to this attempt (reports only).
  sinceStart?: string;
  // The office's Primary doctor (every doctor of the office gets the report), and every doctor's name, Primary first.
  primaryDoctor?: string;
  doctors?: string[];
  // Each training day taken up to this attempt (first try, retake beside it), and repeat success.
  history?: DayHistory[];
  repeats?: { quiz: RepeatStats; soFar: RepeatStats };
  // What the VA does ("All roles", or e.g. "Scheduling, Phones").
  scope?: string;
  // A day's retake: its first try (the official score) question by question.
  retake?: RetakeComparison;
  items: ReportItem[];
  workflows: WorkflowStatus[];
};

// Admin and doctor dashboards only; reports no longer show a trend.
export const TREND_LABELS: Record<Trend, string> = { improving: "Improving", flat: "Flat", declining: "Declining" };

export type DayHistory = {
  day: string;
  percent: number; // first try
  label: ResultLabel | null;
  retakePercent: number | null;
  retakeLabel: ResultLabel | null;
  current: boolean; // this attempt (or its retake)
};

// Questions below full points answered at full points on the repeat, of all the repeats.
export type RepeatStats = { right: number; total: number };

export function repeatStats(items: Pick<ReportItem, "repeated" | "repeat_score" | "type" | "points">[]): RepeatStats {
  const repeated = items.filter((i) => i.repeated);
  return {
    right: repeated.filter((i) => i.repeat_score !== null && i.repeat_score >= (i.type === "mc" ? i.points : 2)).length,
    total: repeated.length,
  };
}

// Critical errors on the first try (after VFDA's overrides).
export const criticalCount = (r: Pick<AttemptReport, "items">) => r.items.filter((i) => i.critical_error).length;

// Grades waiting for VFDA: low-confidence or ungraded answers VFDA hasn't overridden.
export const awaitingReview = (r: Pick<AttemptReport, "items">) =>
  r.items.filter((i) => i.type !== "mc" && !i.overridden && (i.low_confidence || i.first_score === null));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The flags in short ("fast finish, 3 pasted answers"), for Leads4Life and the
// VFDA email; the PDF says the same at length.
export function shortFlags(r: AttemptReport): string[] {
  const awaiting = awaitingReview(r).length;
  const overridden = r.items.filter((i) => i.overridden).length;
  return [
    r.fastFinish && "fast finish",
    !!r.pastedAnswers && plural(r.pastedAnswers, "pasted answer"),
    awaiting > 0 && `${plural(awaiting, "grade")} awaiting VFDA review`,
    overridden > 0 && `${plural(overridden, "score")} changed by VFDA`,
    !!r.retake && "retake",
  ].filter((f): f is string => !!f);
}

export const flagsText = (r: AttemptReport) => shortFlags(r).join(", ") || "none";

export function minutesText(seconds: number | null) {
  if (seconds === null) return "unknown";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// "Maria Test finished W1D2: Building skills" (the doctor's email subject).
export const finishedSubject = (r: Pick<AttemptReport, "vaName" | "dayCode" | "result" | "retake">) =>
  `${r.vaName} finished ${r.dayCode}${r.retake ? " retake" : ""}: ${RESULT_LABELS[r.result]}`;

// The quiz report's sections, or (when it couldn't be made) what the grading
// alone says: things to focus on from the steps to focus on, no "went well".
function bodyOf(r: AttemptReport, q: QuizReport | null) {
  if (q) {
    return {
      wentWell: q.wentWell.map((g) => ({ name: g.name, bullets: g.bullets })),
      focus: q.focus.map((f) => `${f.code}: ${f.text}${f.tag?.kind === "vfda_standard" ? " [VFDA standard]" : ""}`),
      important: q.important.map((c) => `${c.code}: ${c.text}${c.quote ? ` The VA's words: "${c.quote}"` : ""}`),
      flags: q.flags,
      standards: q.standards,
      cardTips: q.cardTips,
    };
  }
  const below = r.items.filter((i) => !i.critical_error && (i.first_score ?? 0) < i.points);
  return {
    wentWell: [],
    focus: below.slice(0, 5).map((i) => `${i.code}: ${i.missed_steps.slice(0, 2).join("; ") || "keep the card's steps in mind"}`),
    important: r.items.filter((i) => i.critical_error).map((i) => `${i.code}: please review the safety steps with the VA. The VA's words: "${i.critical_quote ?? ""}"`),
    flags: shortFlags(r),
    standards: [] as string[],
    cardTips: [] as string[],
  };
}

// What the report says, in order. Every channel renders these sections.
export function reportSections(r: AttemptReport, q: QuizReport | null = null) {
  const rt = r.retake;
  const firstLabel = rt?.first.result ? RESULT_LABELS[rt.first.result] : "–";
  const body = bodyOf(r, q);

  return {
    // Needs extra support (or any critical error): VFDA coaches, the VA keeps going.
    alert: r.result === "at_risk",
    retake: !!rt,
    subject: `${finishedSubject(r)} – ${r.officeName}`,
    summary: [
      ["VA", r.vaName],
      ...(r.scope ? [["VA's role", r.scope] as [string, string]] : []),
      ["Office", r.officeName],
      ...(r.primaryDoctor ? [["Primary doctor", r.primaryDoctor] as [string, string]] : []),
      ["Day", `${r.dayCode}: ${r.dayTitle}${rt ? " (retake)" : ""}`],
      ["Result", RESULT_LABELS[r.result]],
      [rt ? "Retake score" : "Score", scoreLine(r.points, r.maxPoints)],
      ...((rt
        ? [["First try (official)", `${scoreLine(rt.first.points, rt.first.max)} · ${firstLabel}`]]
        : r.retakeScore
          ? [["Retake", scoreLine(r.retakeScore.points, r.retakeScore.max)]]
          : []) as [string, string][]),
      ["Critical errors", String(criticalCount(r))],
      ["Flags", flagsText(r)],
      ["Time spent", minutesText(r.timeSpent)],
      ...(r.sinceStart ? [["Since start", r.sinceStart] as [string, string]] : []),
    ] as [string, string][],
    ...body,
    workflows: r.workflows.map((w) => `${w.code} ${w.name}: ${w.status}${w.why ? ` (${w.why})` : ""}`),
    // Every question, first try next to retake; highlighted: below full points the first time.
    retakeLines: (rt?.lines ?? []).map((l) => ({ text: retakeLineText(l), missed: l.missedFirst })),
    retakeNote: rt
      ? `${rt.fixed} of ${rt.missedFirst} question(s) below full points the first time got full points on the retake. The first try stays the official score; certification uses first-try scores.`
      : "",
  };
}

const NONE = "None";
const ALERT_LINE = "Needs extra support: please coach this VA. They keep going with their training.";

// `link`: the attempt review page (login required).
export function reportText(r: AttemptReport, link: string, q: QuizReport | null = null): string {
  const s = reportSections(r, q);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : NONE);
  return [
    s.summary.map(([k, v]) => `${k}: ${v}`).join("\n"),
    s.alert ? ALERT_LINE : "",
    s.wentWell.length ? `What went well:\n${s.wentWell.map((g) => `${g.name}\n${list(g.bullets)}`).join("\n")}` : "",
    `Things to focus on:\n${list(s.focus)}`,
    s.important.length ? `Important to review:\n${list(s.important)}` : "",
    s.flags.length ? `Flags:\n${list(s.flags)}` : "",
    s.standards.length ? `${STANDARDS_NOTICE.title}\n${STANDARDS_NOTICE.doctor}\n${list(s.standards)}` : "",
    s.cardTips.length ? `Trello card suggestions:\n${list(s.cardTips)}` : "",
    s.retake
      ? `First try vs retake, every question (* = below full points the first time):\n${s.retakeLines
          .map((l) => `${l.missed ? "* " : "- "}${l.text}`)
          .join("\n")}\n${s.retakeNote}`
      : "",
    `Workflow statuses:\n${list(s.workflows)}`,
    `Review the attempt (login required): ${link}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function reportHtml(r: AttemptReport, link: string, q: QuizReport | null = null): string {
  const s = reportSections(r, q);
  const e = escapeHtml;
  const h = (t: string, color = "#111") => `<h3 style="margin:20px 0 6px;font-size:15px;color:${color}">${e(t)}</h3>`;
  const list = (items: string[]) =>
    items.length ? `<ul style="margin:0;padding-left:20px">${items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>` : `<p style="margin:0">${NONE}</p>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">
${s.retake ? `<p style="margin:0 0 12px;padding:6px 12px;background:#e8eefc;color:#1e3a8a;font-weight:bold;letter-spacing:1px">RETAKE</p>` : ""}
${s.alert ? `<p style="margin:0 0 12px;padding:8px 12px;background:#fdf3e1;color:#7a4a00;font-weight:bold">${e(ALERT_LINE)}</p>` : ""}
<table style="border-collapse:collapse">${s.summary
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${e(k)}</td><td style="padding:2px 0"><b>${e(v)}</b></td></tr>`)
    .join("")}</table>
${s.wentWell.length ? `${h("What went well", "#166534")}${s.wentWell.map((g) => `<p style="margin:6px 0 2px;font-weight:bold">${e(g.name)}</p>${list(g.bullets)}`).join("")}` : ""}
${h("Things to focus on")}${list(s.focus)}
${s.important.length ? `${h("Important to review", "#7a4a00")}${list(s.important)}` : ""}
${s.flags.length ? `${h("Flags")}${list(s.flags)}` : ""}
${s.standards.length ? `${h(STANDARDS_NOTICE.title)}<p style="margin:0 0 4px">${e(STANDARDS_NOTICE.doctor)}</p>${list(s.standards)}` : ""}
${s.cardTips.length ? `${h("Trello card suggestions")}${list(s.cardTips)}` : ""}
${
  s.retake
    ? `${h("First try vs retake, every question")}<p style="margin:0 0 4px;color:#555">Highlighted: below full points the first time.</p><ul style="margin:0;padding-left:20px">${s.retakeLines
        .map((l) => (l.missed ? `<li style="background:#fff3cd"><b>${e(l.text)}</b></li>` : `<li>${e(l.text)}</li>`))
        .join("")}</ul><p style="margin:6px 0 0">${e(s.retakeNote)}</p>`
    : ""
}
${h("Workflow statuses")}${list(s.workflows)}
<p style="margin-top:20px"><a href="${e(link)}">Review the attempt</a> (login required)</p>
<p style="margin-top:24px;color:#777;font-size:12px">VFDA VA Quiz App. Practice scenarios use fake patients only.</p>
</div>`;
}

// Slack mrkdwn: escape &, < and > so a VA's words can't ping or link anyone.
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The same summary in short form.
export function reportSlack(r: AttemptReport, link: string, q: QuizReport | null = null): { text: string } {
  const s = reportSections(r, q);
  const line = (label: string, items: string[]) => (items.length ? `*${label}:* ${items.map(slackEscape).join(" · ")}` : "");
  const lines = [
    `*${slackEscape(s.subject)}*`,
    r.retake
      ? `Retake ${scoreLine(r.points, r.maxPoints)} (${RESULT_LABELS[r.result]}) · first try ${scoreLine(r.retake.first.points, r.retake.first.max)} (official) · ${minutesText(r.timeSpent)}`
      : `${RESULT_LABELS[r.result]} · ${scoreLine(r.points, r.maxPoints)}${r.retakeScore ? ` · retake ${scoreLine(r.retakeScore.points, r.retakeScore.max)}` : ""} · ${minutesText(r.timeSpent)}`,
    r.scope ? `VA's role: ${slackEscape(r.scope)}` : "",
    line("What went well", s.wentWell.flatMap((g) => g.bullets)),
    line("Focus on", s.focus),
    line("Important to review", s.important),
    line("Flags", s.flags),
    line("Trello card suggestions", s.cardTips),
    r.retake
      ? `*First try → retake* (bold = below full points the first time): ${s.retakeLines
          .map((l) => (l.missed ? `*${slackEscape(l.text)}*` : slackEscape(l.text)))
          .join(" · ")}`
      : "",
    line("Workflows", s.workflows),
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
  primaryDoctor?: string | null;
};

export function criticalAlertText(a: CriticalAlert) {
  return {
    subject: `ALERT: critical error – ${a.vaName} – ${a.dayCode} ${a.code} – ${a.officeName}`,
    lines: [
      `${a.vaName} (${a.officeName}${a.primaryDoctor ? `, Primary doctor ${a.primaryDoctor}` : ""}) made a critical error on ${a.dayCode} ${a.code} (${a.workflow})${a.repeat ? ", on the repeat" : ""}. They keep going with their training; please coach them.`,
      `Scenario: ${a.stem}`,
      `The VA's exact words: "${a.quote}"`,
    ],
  };
}

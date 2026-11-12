// My report as a PDF ("Download PDF" on My report): the same content as the
// page and nothing else (src/lib/va-report.ts, VaReportView). Drawn with
// src/lib/pdf-kit.ts.

import { muted, Pdf, resultTone, toneColor, type Para } from "@/lib/pdf-kit";
import { minutesText } from "@/lib/report";
import { STANDARDS_NOTICE, tipTagText } from "@/lib/rule-source";
import { TREND_LINE, type VaReportView } from "@/lib/va-report";

export const vaReportFileName = (v: Pick<VaReportView, "dayCode" | "retake">) =>
  `My report - ${v.dayCode}${v.retake ? " retake" : ""}.pdf`.replace(/[^\w .()-]+/g, " ");

export async function vaReportPdf(v: VaReportView): Promise<Uint8Array> {
  const pdf = await Pdf.create({
    title: `My report: ${v.dayCode}${v.retake ? " (retake)" : ""}`,
    headerTitle: `My report · ${v.dayCode}${v.retake ? " retake" : ""}`,
  });
  const red = toneColor("danger");

  pdf.titleBlock(
    `My report: ${v.dayCode}${v.topic ? ` – ${v.topic}` : ""}`,
    [`Office: ${v.officeName}`, `VA: ${v.vaName}`, new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" })].join("  ·  "),
    v.retake ? { text: "RETAKE", tone: "accent" } : undefined,
  );
  pdf.badgeRow([
    {
      caption: v.retake ? "Retake score" : "First-try score",
      text: `${v.percent}%`,
      tone: "primary",
    },
    { caption: "Result", text: v.resultLabel, tone: resultTone(v.resultLabel) },
    { caption: "Time spent", text: minutesText(v.timeSpent), tone: "neutral" },
    ...(v.retakePercent !== null
      ? [
          {
            caption: "Retake",
            text: `${v.retakePercent}%`,
            tone: "accent" as const,
          },
        ]
      : []),
    ...(v.firstTryPercent !== null
      ? [
          {
            caption: "First try was",
            text: `${v.firstTryPercent}%`,
            tone: "neutral" as const,
          },
        ]
      : []),
  ]);

  // Alerts.
  if (!v.alerts.length && !v.flags.length) {
    pdf.box("neutral", [
      {
        text: "Alerts: No critical errors or flags",
        font: "bold",
        size: 10.5,
        color: muted,
      },
    ]);
  } else {
    const paras: Para[] = [
      {
        text: "Alerts",
        font: "bold",
        size: 11,
        color: v.alerts.length ? red : undefined,
        gap: 3,
      },
    ];
    if (v.alerts.length) {
      paras.push({
        text: "Critical errors",
        font: "bold",
        size: 10,
        color: red,
        gap: 1,
      });
      for (const a of v.alerts) paras.push({ text: `- ${a}`, size: 10, indent: 6, color: red, gap: 2 });
    }
    if (v.flags.length) {
      paras.push({ text: "Flags", font: "bold", size: 10, gap: 1 });
      for (const f of v.flags) paras.push({ text: `- ${f}`, size: 10, indent: 6, gap: 2 });
    }
    pdf.box(v.alerts.length ? "danger" : "warning", paras);
  }

  // The rules VFDA's standard was used for (rules only, no scenarios or answers).
  if (v.standards.length) {
    pdf.box("info", [
      {
        text: STANDARDS_NOTICE.title,
        font: "bold",
        size: 11,
        color: toneColor("info"),
        gap: 3,
      },
      { text: STANDARDS_NOTICE.va, size: 10, gap: 4 },
      ...v.standards.map((s) => ({
        text: `- ${s}`,
        size: 10,
        indent: 6,
        gap: 1,
      })),
    ]);
  }

  pdf.heading("Trend");
  pdf.barChart(
    v.trend.rows.map((r) => ({
      label: r.day,
      value: r.percent,
      tone: r.current ? ("primary" as const) : ("success" as const),
      bold: r.current,
      note: `${r.percent}%${r.current ? "  (this quiz)" : ""}`,
    })),
  );
  pdf.text(v.trend.direction ? TREND_LINE[v.trend.direction] : "First day: your trend starts after your next quiz.", { font: "bold", size: 10 });

  pdf.heading("Coaching tips");
  if (!v.ready) pdf.text("Your coaching tips are being written. Check back in a few minutes.", { color: muted });
  else if (!v.tips.length)
    pdf.text("Nothing to fix: every question got full points.", {
      color: muted,
    });
  v.tips.forEach((t, n) => {
    const tag = v.tipTags[n];
    pdf.numbered(
      n + 1,
      `Tip ${n + 1}`,
      tag
        ? {
            text: tipTagText(tag),
            tone: tag.kind === "vfda_standard" ? "info" : "neutral",
          }
        : null,
      [{ text: t, size: 10 }],
    );
  });
  if (v.strengths.length) {
    pdf.heading("What you did well", { keep: 50, color: toneColor("success") });
    pdf.bullets(v.strengths, { size: 10 });
  }
  return pdf.save();
}

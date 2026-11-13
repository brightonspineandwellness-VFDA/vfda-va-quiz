// My report as a PDF ("Download PDF" on My report): the same content as the
// page and nothing else (src/lib/va-report.ts, VaReportView), in the same
// order: score + label, What went well, Things to focus on, Important to
// review, flags, the VFDA standards notice, and the encouraging last line.
// Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, resultTone, toneColor } from "@/lib/pdf-kit";
import { minutesText } from "@/lib/report";
import { STANDARDS_NOTICE, tipTagText } from "@/lib/rule-source";
import type { VaReportView } from "@/lib/va-report";

export const vaReportFileName = (v: Pick<VaReportView, "dayCode" | "retake">) =>
  `My report - ${v.dayCode}${v.retake ? " retake" : ""}.pdf`.replace(/[^\w .()-]+/g, " ");

export async function vaReportPdf(v: VaReportView): Promise<Uint8Array> {
  const pdf = await Pdf.create({
    title: `My report: ${v.dayCode}${v.retake ? " (retake)" : ""}`,
    headerTitle: `My report · ${v.dayCode}${v.retake ? " retake" : ""}`,
  });
  const success = toneColor("success");

  pdf.titleBlock(
    `My report: ${v.dayCode}${v.topic ? ` – ${v.topic}` : ""}`,
    [`Office: ${v.officeName}`, `VA: ${v.vaName}`, new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" })].join("  ·  "),
    v.retake ? { text: "RETAKE", tone: "accent" } : undefined,
  );
  pdf.badgeRow([
    { caption: "Result", text: v.resultLabel, tone: resultTone(v.resultLabel) },
    { caption: v.retake ? "Retake score" : "Score", text: v.score, tone: "primary" },
    ...(v.otherScore ? [{ caption: v.otherScore.caption, text: v.otherScore.text, tone: "accent" as const }] : []),
    { caption: "Time spent", text: minutesText(v.timeSpent), tone: "neutral" },
  ]);

  if (!v.ready) {
    pdf.text("Your report is being written. Check back in a few minutes.", { color: muted });
    return pdf.save();
  }

  pdf.heading("What went well", { keep: 60, color: success });
  if (!v.wentWell.length) pdf.text("You finished every question. Your strengths show up here as you build them.", { color: muted });
  for (const g of v.wentWell) {
    pdf.ensure(30);
    if (g.name) pdf.text(g.name, { font: "bold", size: 10.5, gap: 1 });
    pdf.bullets(g.bullets, { size: 10, gap: 2 });
    pdf.gap(4);
  }

  pdf.heading("Things to focus on");
  if (!v.tips.length) pdf.text("Nothing this time: keep doing what you're doing.", { color: muted });
  v.tips.forEach((t, n) => {
    const tag = v.tipTags[n];
    pdf.numbered(
      n + 1,
      `Focus ${n + 1}`,
      tag ? { text: tipTagText(tag), tone: tag.kind === "vfda_standard" ? "info" : "neutral" } : null,
      [{ text: t, size: 10 }],
    );
  });

  if (v.important.length) {
    pdf.box("warning", [
      { text: "Important to review", font: "bold", size: 11, color: toneColor("warning"), gap: 3 },
      ...v.important.map((a) => ({ text: `- ${a}`, size: 10, indent: 6, gap: 2 })),
    ]);
  }

  if (v.flags.length) {
    pdf.box("neutral", [
      { text: "Keep in mind", font: "bold", size: 10.5, gap: 2 },
      ...v.flags.map((f) => ({ text: `- ${f}`, size: 10, indent: 6, gap: 2 })),
    ]);
  }

  // The rules VFDA's standard was used for (rules only, no scenarios or answers).
  if (v.standards.length) {
    pdf.box("info", [
      { text: STANDARDS_NOTICE.title, font: "bold", size: 11, color: toneColor("info"), gap: 3 },
      { text: STANDARDS_NOTICE.va, size: 10, gap: 4 },
      ...v.standards.map((s) => ({ text: `- ${s}`, size: 10, indent: 6, gap: 1 })),
    ]);
  }

  pdf.gap(6);
  pdf.text(v.closing, { font: "bold", size: 11, color: success });
  return pdf.save();
}

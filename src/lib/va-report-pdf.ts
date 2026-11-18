// My report as a PDF ("Download PDF" on My report): the same content as the
// page and nothing else (src/lib/va-report.ts, VaReportView), in the same
// order, and never a score: Completed ✓ + label + "Day X of Y completed",
// Skills you showed, Skills to practice, Important to review, a small tip,
// the VFDA standards notice, and the encouraging last line.
// Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, resultTone, toneColor } from "@/lib/pdf-kit";
import { STANDARDS_NOTICE, tipTagText } from "@/lib/rule-source";
import { COMPLETED, progressText } from "@/lib/va-flow";
import type { VaReportView } from "@/lib/va-report";

export const vaReportFileName = (v: Pick<VaReportView, "dayCode" | "retake">) =>
  `My report - ${v.dayCode}${v.retake ? " practice" : ""}.pdf`.replace(/[^\w .()-]+/g, " ");

export async function vaReportPdf(v: VaReportView): Promise<Uint8Array> {
  const pdf = await Pdf.create({
    title: `My report: ${v.dayCode}${v.retake ? " (practiced again)" : ""}`,
    headerTitle: "My report",
  });
  const success = toneColor("success");

  pdf.titleBlock(
    `My report: ${v.dayCode}${v.topic ? ` – ${v.topic}` : ""}`,
    [v.officeName, `VA: ${v.vaName}`, new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" })].join("  ·  "),
    v.retake ? { text: "Practiced again", tone: "accent" } : undefined,
  );
  pdf.badgeRow([
    { caption: "Status", text: COMPLETED, tone: "success" },
    { caption: "Result", text: v.resultLabel, tone: resultTone(v.resultLabel) },
    ...(v.progress ? [{ caption: "Your progress", text: progressText(v.progress), tone: "primary" as const }] : []),
  ]);
  if (v.progress) pdf.progress(v.progress.done, v.progress.total);

  if (!v.ready) {
    pdf.text("Your report is being written. Check back in a few minutes.", { color: muted });
    return pdf.save();
  }

  pdf.heading("Skills you showed", { keep: 60, color: success });
  if (!v.skills.length) pdf.text("You finished every question. Your skills show up here as you build them.", { color: muted });
  for (const g of v.skills) {
    pdf.ensure(40);
    if (g.name) pdf.text(g.name, { font: "bold", size: 10.5, gap: 0 });
    pdf.checkChips(g.bullets);
  }
  if (v.highlight) pdf.text(v.highlight, { size: 10, gap: 4 });

  pdf.heading("Skills to practice");
  if (!v.tips.length) pdf.text("Nothing this time: keep doing what you're doing.", { color: muted });
  v.tips.forEach((t, n) => {
    const tag = v.tipTags[n];
    pdf.numbered(n + 1, t, tag ? { text: tipTagText(tag), tone: tag.kind === "vfda_standard" ? "info" : "neutral" } : null, []);
  });

  if (v.important.length) {
    pdf.box("warning", [
      { text: "Important to review", font: "bold", size: 11, color: toneColor("warning"), gap: 3 },
      ...v.important.map((a) => ({ text: a, size: 10, gap: 3 })),
    ]);
  }

  if (v.flags.length) {
    pdf.box("neutral", [{ text: "A small tip", font: "bold", size: 10.5, gap: 2 }, ...v.flags.map((f) => ({ text: f, size: 10, gap: 2 }))]);
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

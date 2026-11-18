// The doctor's quiz report PDF ("VA Training Report", src/lib/quiz-report.ts),
// the one Leads4Life delivers and VFDA gets attached. No scores anywhere: no
// points, percentages, "X of Y" or per-question scores. In order:
// a) Status Completed ✓, the label and "Day X of Y completed" with a bar,
// b) Skills [VA] showed (a checkmark list by workflow), c) Skills to practice
// (each with "Review: <card>" and the VFDA standard tag), d) Important to
// review (critical errors only, calm), e) gentle flags, f) the VFDA standards
// notice, g) Trello card suggestions. Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, resultTone, toneColor, type Para } from "@/lib/pdf-kit";
import type { QuizReport } from "@/lib/quiz-report";
import { STANDARDS_NOTICE, tipTagText, type TipTag } from "@/lib/rule-source";
import { COMPLETED, progressText } from "@/lib/va-flow";

const tagBadge = (t: TipTag | null | undefined) =>
  t
    ? {
        text: tipTagText(t),
        tone: t.kind === "vfda_standard" ? ("info" as const) : ("neutral" as const),
      }
    : null;

export async function quizReportPdf(r: QuizReport): Promise<Uint8Array> {
  const first = r.vaName.trim().split(/\s+/)[0] || "Your VA";
  const pdf = await Pdf.create({
    title: `VA Training Report: ${r.vaName} - ${r.dayCode}${r.retake ? " (practiced again)" : ""}`,
    headerTitle: "VA Training Report",
  });
  const success = toneColor("success");
  const warning = toneColor("warning");

  // a) Who, where, when; then the status, label and progress.
  pdf.titleBlock(
    "VA Training Report",
    [
      r.officeName,
      r.doctors.length ? r.doctors.join(", ") : null,
      `VA: ${r.vaName}`,
      `${r.dayCode} ${r.topic}`.trim(),
      new Date(r.date).toLocaleDateString("en-US", { dateStyle: "medium" }),
    ]
      .filter(Boolean)
      .join("  ·  "),
    r.retake ? { text: "Practiced again", tone: "accent" } : undefined,
  );
  pdf.badgeRow([
    { caption: "Status", text: COMPLETED, tone: "success" },
    { caption: "Result", text: r.resultLabel, tone: resultTone(r.resultLabel) },
    ...(r.progress ? [{ caption: "Training progress", text: progressText(r.progress), tone: "primary" as const }] : []),
  ]);
  if (r.progress) pdf.progress(r.progress.done, r.progress.total);

  // b) Skills shown: the biggest section.
  pdf.heading(`Skills ${first} showed`, { keep: 60, color: success });
  if (!r.skills.length) pdf.text(`${first} finished every question; skills show up here as they build.`, { color: muted });
  for (const g of r.skills) {
    pdf.ensure(40);
    if (g.name) pdf.text(g.name, { font: "bold", size: 10.5, gap: 0 });
    pdf.checkChips(g.bullets);
  }

  // c) Skills to practice: the same list the VA sees.
  pdf.heading("Skills to practice", { keep: 60 });
  if (!r.practice.length) pdf.text("Nothing this time: keep doing what you're doing.", { color: muted });
  r.practice.forEach((p, n) => pdf.numbered(n + 1, p.text, tagBadge(p.tag), []));

  // d) Important to review: critical errors only, calm wording.
  if (r.doctorImportant.length) {
    const n = r.doctorImportant.length - 1;
    const paras: Para[] = [
      { text: "Important to review", font: "bold", size: 11, color: warning, gap: 2 },
      { text: `${n} safety item${n === 1 ? "" : "s"}`, size: 9.5, color: muted, gap: 4 },
      ...r.doctorImportant.map((t) => ({ text: t, size: 10, gap: 3 })),
    ];
    pdf.box("warning", paras);
  }

  // e) Flags, gently.
  if (r.doctorFlags.length) {
    pdf.box("neutral", [{ text: "Flags", font: "bold", size: 10.5, gap: 2 }, ...r.doctorFlags.map((f) => ({ text: f, size: 9.5, gap: 2 }))]);
  }

  // f) The rules checked against a VFDA standard because the cards didn't cover them.
  if (r.standards.length) {
    pdf.box("info", [
      { text: STANDARDS_NOTICE.title, font: "bold", size: 11, color: toneColor("info"), gap: 3 },
      { text: STANDARDS_NOTICE.doctor, size: 9.5, gap: 4 },
      ...r.standards.map((s) => ({ text: `- ${s}`, size: 9.5, indent: 6, gap: 1 })),
    ]);
  }

  // g) Trello card suggestions.
  if (r.cardTips.length) {
    pdf.heading("Trello card suggestions", { keep: 50 });
    pdf.bullets(r.cardTips, { size: 10, gap: 2 });
  }
  return pdf.save();
}

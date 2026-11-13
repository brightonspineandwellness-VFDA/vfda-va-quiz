// The doctor/VFDA quiz report PDF (src/lib/quiz-report.ts), in order:
// a) score + label (raw score, and the retake beside it), b) What went well
// (grouped by workflow, the biggest section), c) Things to focus on (each
// with its card and "VFDA standard" tag), d) Important to review (critical
// errors only, with the VA's words), e) Flags, f) the VFDA standards notice,
// g) Trello card suggestions and the coaching tips given to the VA.
// No scenarios and no VA answers (the attempt page in the app has them).
// Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, resultTone, toneColor, type Para } from "@/lib/pdf-kit";
import { scoreLine, type QuizReport } from "@/lib/quiz-report";
import { minutesText } from "@/lib/report";
import { STANDARDS_NOTICE, tipTagText, type TipTag } from "@/lib/rule-source";

const cut = (s: string, n: number) => {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

const tagBadge = (t: TipTag | null | undefined) =>
  t
    ? {
        text: tipTagText(t),
        tone: t.kind === "vfda_standard" ? ("info" as const) : ("neutral" as const),
      }
    : null;

export async function quizReportPdf(r: QuizReport): Promise<Uint8Array> {
  const pdf = await Pdf.create({
    title: `Quiz report: ${r.vaName} - ${r.dayCode}${r.retake ? " (retake)" : ""}`,
    headerTitle: `Quiz report · ${r.dayCode}${r.retake ? " retake" : ""}`,
  });
  const success = toneColor("success");
  const warning = toneColor("warning");

  // a) Who, where, when; then the score and label.
  pdf.titleBlock(
    `Quiz report: ${r.vaName}`,
    [
      `Office: ${r.officeName}`,
      r.doctors.length ? `${r.doctors.length > 1 ? "Doctors" : "Doctor"}: ${r.doctors.join(", ")}` : null,
      `VA: ${r.vaName}`,
      new Date(r.date).toLocaleDateString("en-US", { dateStyle: "medium" }),
    ]
      .filter(Boolean)
      .join("  ·  "),
    r.retake ? { text: "RETAKE", tone: "accent" } : undefined,
  );
  pdf.text(`${r.dayCode}: ${r.topic}`, { font: "bold", size: 11, gap: 4 });
  pdf.badgeRow([
    { caption: "Result", text: r.resultLabel, tone: resultTone(r.resultLabel) },
    { caption: r.retake ? "Retake score" : "Score", text: scoreLine(r.points, r.maxPoints), tone: "primary" },
    ...(r.otherScore ? [{ caption: r.otherScore.caption, text: scoreLine(r.otherScore.points, r.otherScore.max), tone: "accent" as const }] : []),
    { caption: "Time spent", text: minutesText(r.timeSpent), tone: "neutral" },
  ]);

  // b) What went well: the biggest section.
  pdf.heading("What went well", { keep: 60, color: success });
  if (!r.wentWell.length) pdf.text("They finished every question; the strengths show up here as they build.", { color: muted });
  for (const g of r.wentWell) {
    pdf.ensure(30);
    pdf.text(g.name, { font: "bold", size: 10.5, gap: 1 });
    pdf.bullets(g.bullets, { size: 10, gap: 2 });
    pdf.gap(4);
  }

  // c) Things to focus on.
  pdf.heading("Things to focus on", { keep: 60 });
  if (!r.focus.length) pdf.text("Nothing this time: every other question got full points.", { color: muted });
  r.focus.forEach((f, n) => pdf.numbered(n + 1, f.code, tagBadge(f.tag), [{ text: f.text, size: 10 }]));
  if (r.moreFocus > 0) pdf.text(`+${r.moreFocus} more on the attempt page`, { color: muted, size: 9.5 });

  // d) Important to review: critical errors only, calm wording, the VA's words for the doctor.
  if (r.important.length) {
    const paras: Para[] = [{ text: "Important to review", font: "bold", size: 11, color: warning, gap: 4 }];
    for (const c of r.important) {
      paras.push(
        { text: `${c.code} · ${c.topic}`, font: "bold", size: 9.5, gap: 1 },
        { text: c.text, size: 9.5, indent: 8, gap: 1 },
        ...(c.quote ? [{ text: `The VA's words: "${cut(c.quote, 300)}"`, size: 9.5, indent: 8, gap: 1 }] : []),
        { text: `Why it matters: ${cut(c.why, 300)}`, size: 9.5, indent: 8, color: muted, gap: 5 },
      );
    }
    pdf.box("warning", paras);
  }

  // e) Flags.
  if (r.flags.length) {
    pdf.box("neutral", [
      { text: "Flags", font: "bold", size: 10.5, gap: 2 },
      ...r.flags.map((f) => ({ text: `- ${f}`, size: 9.5, indent: 6, gap: 1 })),
    ]);
  }

  // f) The rules checked against a VFDA standard because the cards didn't cover them.
  if (r.standards.length) {
    pdf.box("info", [
      { text: STANDARDS_NOTICE.title, font: "bold", size: 11, color: toneColor("info"), gap: 3 },
      { text: STANDARDS_NOTICE.doctor, size: 9.5, gap: 4 },
      ...r.standards.map((s) => ({ text: `- ${s}`, size: 9.5, indent: 6, gap: 1 })),
    ]);
  }

  // g) Doctor/VFDA only: Trello card suggestions, and exactly what the VA sees on My report.
  pdf.heading("Trello card suggestions", { keep: 50 });
  if (!r.cardTips.length) pdf.text("None: the cards covered everything in this quiz.", { color: muted });
  else pdf.bullets(r.cardTips, { size: 10, gap: 2 });

  pdf.heading("Coaching tips given to the VA", { keep: 60 });
  if (!r.vaTips) pdf.text("Not written yet: they appear here once the VA's report is made.", { color: muted });
  else {
    if (r.vaTips.alerts.length) {
      pdf.text("Important to review", { font: "bold", size: 10, gap: 1, color: warning });
      pdf.bullets(r.vaTips.alerts, { size: 9.5, gap: 2 });
      pdf.gap(4);
    }
    if (!r.vaTips.tips.length) pdf.text("No focus tips: every other question got full points.", { size: 9.5, color: muted });
    r.vaTips.tips.forEach((tip, n) => pdf.numbered(n + 1, `Focus tip ${n + 1}`, tagBadge(r.vaTips?.tags?.[n]), [{ text: tip, size: 9.5 }]));
    if (r.vaTips.strengths.length) {
      pdf.ensure(30);
      pdf.text("What went well (as the VA sees it)", { font: "bold", size: 10, gap: 1, color: success });
      pdf.bullets(r.vaTips.strengths.map((s) => s.replace(/^\[[^\]]+\]\s*/, "")), { size: 9.5, gap: 2 });
    }
  }
  return pdf.save();
}

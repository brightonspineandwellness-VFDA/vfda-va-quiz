// The doctor/VFDA quiz report PDF (src/lib/quiz-report.ts), in order:
// a) score + label (raw score, and the retake beside it), a2) Your cards vs.
// VFDA standard (what came from the office's cards, and what isn't on a
// card yet), b) What went well
// (grouped by workflow, the biggest section), c) Things to focus on (each
// with its card and "VFDA standard" tag), d) Important to review (critical
// errors only, with the VA's words), e) Flags,
// g) Trello card suggestions and the coaching tips given to the VA.
// No scenarios and no VA answers (the attempt page in the app has them).
// Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, primary, resultTone, toneColor, type Para } from "@/lib/pdf-kit";
import { scoreLine, type QuizReport } from "@/lib/quiz-report";
import { minutesText } from "@/lib/report";
import { tipTagText, type TipTag } from "@/lib/rule-source";

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

// "From your Trello cards" / "VFDA standard: not on your cards yet".
export function sourcesSection(pdf: Pdf, r: Pick<QuizReport, "cardsTested" | "standards">, o: { when?: string; max?: number } = {}) {
  const when = o.when ?? "today's";
  const shown = o.max ? r.standards.slice(0, o.max) : r.standards;
  const more = r.standards.length - shown.length;
  pdf.heading("Your cards vs. VFDA standard", { keep: 90 });
  const cards = r.cardsTested ?? [];
  pdf.box("primary", [
    { text: "From your Trello cards", font: "bold", size: 10.5, color: primary, gap: 2 },
    ...(cards.length
      ? cards.map((c) => ({
          text: `- ${c.card}: ${c.questions} question${c.questions === 1 ? "" : "s"}${c.fullMarks ? ` (${c.fullMarks} with full points)` : ""}`,
          size: 9.5,
          indent: 6,
          gap: 1,
        }))
      : [{ text: `None of ${when} questions came from your cards.`, size: 9.5, color: muted }]),
  ]);
  if (r.standards.length) {
    pdf.box("info", [
      { text: "VFDA standard: not on your cards yet", font: "bold", size: 10.5, color: toneColor("info"), gap: 2 },
      {
        text: "Your cards don't cover these yet, so your VA learned VFDA's standard way. If your office does it differently, add it to the card and your VA will learn your way from then on.",
        size: 9.5,
        gap: 4,
      },
      ...shown.map((s) => ({ text: `- ${s}`, size: 9.5, indent: 6, gap: 1 })),
      ...(more > 0 ? [{ text: `+ ${more} more (each daily quiz report lists the ones that day used)`, size: 9.5, color: muted, indent: 6, gap: 1 }] : []),
    ]);
  } else {
    pdf.text(`Everything in ${when} quiz came from your cards.`, { size: 9.5, color: muted, gap: 4 });
  }
}

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

  // a2) Where the questions came from: the office's own cards vs. VFDA's
  // standard (what isn't written on a card yet), so the doctor sees what
  // the VA was taught from their cards and what still needs a card.
  sourcesSection(pdf, r);

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

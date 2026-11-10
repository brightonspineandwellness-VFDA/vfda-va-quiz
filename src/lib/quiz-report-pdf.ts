// The quiz report PDF (src/lib/quiz-report.ts): header, "Needs work" one
// block per item (critical errors first, marked), "What they did well".
// One to three pages: when the blocks don't fit, the last ones are left out
// with "+N more on the attempt page". Standard Helvetica only.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfText, wrap } from "@/lib/office-report-pdf";
import { evaluationText, type QuizReport } from "@/lib/quiz-report";
import { minutesText } from "@/lib/report";

const PAGE = { width: 612, height: 792 }; // US Letter
const MARGIN = 48;
const WIDTH = PAGE.width - MARGIN * 2;
const MAX_PAGES = 3;
// Long scenarios and answers are cut so one item never fills a page.
const MAX_SCENARIO = 600;
const MAX_ANSWER = 700;

const cut = (s: string, n: number) => {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

export async function quizReportPdf(r: QuizReport): Promise<Uint8Array> {
  for (let shown = r.needsWork.length; ; shown--) {
    const doc = await draw(r, shown);
    if (doc.getPageCount() <= MAX_PAGES || shown === 0) return doc.save();
  }
}

async function draw(r: QuizReport, shown: number) {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(`Quiz report: ${r.vaName} - ${r.dayCode}${r.retake ? " (retake)" : ""}`));
  doc.setAuthor("VFDA");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);
  const red = rgb(0.72, 0.11, 0.11);
  const blue = rgb(0.12, 0.23, 0.54);

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };
  type Style = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number; right?: number };
  const lineHeight = (size: number) => size * 1.3;
  const text = (s: string, o: Style = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 9.5;
    const indent = o.indent ?? 0;
    for (const line of wrap(s, font, size, WIDTH - indent - (o.right ?? 0))) {
      if (y - lineHeight(size) < MARGIN + 16) newPage();
      y -= lineHeight(size);
      page.drawText(line, { x: MARGIN + indent, y: y + size * 0.3, size, font, color: o.color ?? ink });
    }
    y -= o.gap ?? 1;
  };
  // "Label: text", the label in bold on its own line when the text is long.
  const field = (label: string, value: string, color = ink) => {
    text(label, { font: bold, size: 8.5, color: muted, indent: 10, gap: 0 });
    text(value || "(left empty)", { size: 9, color, indent: 10, gap: 2 });
  };
  const heightOf = (s: string, font: PDFFont, size: number, indent = 10) => wrap(s, font, size, WIDTH - indent).length * lineHeight(size);
  const heading = (s: string, color = ink) => {
    if (y - 50 < MARGIN + 16) newPage();
    y -= 8;
    text(s, { font: bold, size: 12, color, gap: 3 });
  };

  // Header.
  text(`Quiz report: ${r.vaName}${r.retake ? "  ·  RETAKE" : ""}`, { font: bold, size: 15, gap: 3, color: r.retake ? blue : ink });
  text(
    [`Office: ${r.officeName}`, r.doctor ? `Doctor: ${r.doctor}` : null, new Date(r.date).toLocaleDateString("en-US", { dateStyle: "medium" })]
      .filter(Boolean)
      .join("  ·  "),
    { color: muted, size: 9 },
  );
  text(`${r.dayCode}: ${r.topic}`, { size: 10, gap: 3 });
  const percent = r.maxPoints ? Math.round((r.points * 100) / r.maxPoints) : 0;
  text(
    `${r.retake ? "Retake score" : "First-try score"} ${r.points}/${r.maxPoints} (${percent}%)   ·   ${r.resultLabel}   ·   Time spent ${minutesText(r.timeSpent)}`,
    { font: bold, size: 10.5, gap: 2 },
  );

  // Alerts: red when anything is in it.
  const { critical, flags } = r.alerts;
  y -= 6;
  const boxTop = y;
  const pad = 8;
  const boxIndent = pad;
  const alertsStart = doc.getPageCount();
  y -= pad;
  if (!critical.length && !flags.length) {
    text("Alerts: No critical errors or flags", { font: bold, size: 10, indent: boxIndent, color: muted, gap: 2, right: pad });
  } else {
    text(`Alerts: ${critical.length} critical error${critical.length === 1 ? "" : "s"}${flags.length ? `, ${flags.length} flag${flags.length === 1 ? "" : "s"}` : ""}`, { font: bold, size: 10.5, indent: boxIndent, color: red, gap: 2, right: pad });
    for (const c of critical) {
      text(`CRITICAL · ${c.code} · ${c.topic}`, { font: bold, size: 9.5, indent: boxIndent, color: red, gap: 0, right: pad });
      text(`VA's words: "${cut(c.quote, 300)}"`, { size: 9, indent: boxIndent + 8, color: red, gap: 0, right: pad });
      text(`Why it's critical: ${cut(c.why, 300)}`, { size: 9, indent: boxIndent + 8, gap: 0, right: pad });
      text(`Coaching: ${c.coaching}`, { size: 9, indent: boxIndent + 8, gap: 3, right: pad });
    }
    if (flags.length) {
      text("Flags", { font: bold, size: 9.5, indent: boxIndent, gap: 0, right: pad });
      for (const f of flags) text(`- ${f}`, { size: 9, indent: boxIndent + 8, right: pad });
    }
  }
  y -= pad - 2;
  // The box, drawn as a border after its text (on one page only: it fits unless it's very long).
  if (doc.getPageCount() === alertsStart) {
    const any = critical.length > 0 || flags.length > 0;
    page.drawRectangle({
      x: MARGIN,
      y,
      width: WIDTH,
      height: boxTop - y,
      borderColor: any ? red : rgb(0.75, 0.75, 0.75),
      borderWidth: any ? 1.5 : 0.6,
    });
    // A red bar down the left edge when there's anything in it.
    if (any) page.drawRectangle({ x: MARGIN, y, width: 4, height: boxTop - y, color: red });
  }

  heading("Needs work");
  if (!r.needsWork.length) text("Nothing: every item got full points.", { color: muted, indent: 6 });
  for (const i of r.needsWork.slice(0, shown)) {
    const title = `${i.critical ? "CRITICAL ERROR · " : ""}${i.code} · ${i.workflowName}`;
    // Keep the item's title with at least its scenario.
    if (y - (lineHeight(10) + 14 + heightOf(cut(i.scenario, 160), regular, 9)) < MARGIN + 16) newPage();
    y -= 4;
    text(title, { font: bold, size: 10, color: i.critical ? red : ink, gap: 1 });
    field("Scenario", cut(i.scenario, MAX_SCENARIO));
    field("VA's answer (exact words)", cut(i.answer, MAX_ANSWER));
    field(
      "Evaluation",
      [evaluationText(i), ...i.missed.map((m) => `Missed: ${m}`), ...(i.critical && i.criticalQuote ? [`Critical, in the VA's words: "${i.criticalQuote}"`] : [])].join("\n"),
      i.critical ? red : ink,
    );
    field("Coaching tip for the VA", i.coaching);
    field("Trello card tip for the doctor", i.cardTip);
  }
  if (shown < r.needsWork.length) text(`+${r.needsWork.length - shown} more on the attempt page`, { color: muted, indent: 6, size: 9 });

  heading("What they did well");
  if (!r.strengths.length) text("No item got full points this time.", { color: muted, indent: 6 });
  for (const s of r.strengths) {
    text(`${s.workflow} ${s.name}`, { font: bold, size: 9.5, indent: 6, gap: 0 });
    for (const b of s.bullets) text(`- ${b}`, { size: 9, indent: 14 });
    y -= 2;
  }

  const pages = doc.getPages();
  pages.forEach((p, n) =>
    p.drawText(pdfText(`${r.vaName} · ${r.dayCode}${r.retake ? " retake" : ""} · page ${n + 1} of ${pages.length}`), {
      x: MARGIN,
      y: MARGIN / 2,
      size: 8,
      font: regular,
      color: muted,
    }),
  );
  return doc;
}

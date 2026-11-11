// My report as a PDF ("Download PDF" on My report): the same content as the
// page and nothing else (src/lib/va-report.ts, VaReportView). Standard Helvetica.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfText, wrap } from "@/lib/office-report-pdf";
import { minutesText } from "@/lib/report";
import { TREND_LINE, type VaReportView } from "@/lib/va-report";

const PAGE = { width: 612, height: 792 }; // US Letter
const MARGIN = 48;
const WIDTH = PAGE.width - MARGIN * 2;

export const vaReportFileName = (v: Pick<VaReportView, "dayCode" | "retake">) =>
  `My report - ${v.dayCode}${v.retake ? " retake" : ""}.pdf`.replace(/[^\w .()-]+/g, " ");

export async function vaReportPdf(v: VaReportView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(`My report: ${v.dayCode}${v.retake ? " (retake)" : ""}`));
  doc.setAuthor("VFDA");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);
  const red = rgb(0.72, 0.11, 0.11);
  const blue = rgb(0.12, 0.23, 0.54);
  const green = rgb(0.16, 0.55, 0.27);

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  type Style = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number };
  const lh = (size: number) => size * 1.35;
  const text = (s: string, o: Style = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10;
    const indent = o.indent ?? 0;
    for (const line of wrap(s, font, size, WIDTH - indent)) {
      if (y - lh(size) < MARGIN + 16) {
        page = doc.addPage([PAGE.width, PAGE.height]);
        y = PAGE.height - MARGIN;
      }
      y -= lh(size);
      page.drawText(line, { x: MARGIN + indent, y: y + size * 0.3, size, font, color: o.color ?? ink });
    }
    y -= o.gap ?? 1;
  };
  const heading = (s: string, color = ink) => {
    y -= 10;
    text(s, { font: bold, size: 12.5, color, gap: 4 });
  };
  const bullets = (items: string[], color = ink) => items.forEach((b) => text(`- ${b}`, { indent: 10, color, gap: 3 }));

  // Header.
  text(`My report: ${v.dayCode}${v.topic ? ` – ${v.topic}` : ""}${v.retake ? "  ·  RETAKE" : ""}`, { font: bold, size: 15, gap: 3, color: v.retake ? blue : ink });
  text(new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" }), { color: muted, size: 9.5, gap: 3 });
  text(
    [
      `${v.retake ? "Retake score" : "First-try score"} ${v.percent}%`,
      v.resultLabel,
      `Time spent ${minutesText(v.timeSpent)}`,
      v.retakePercent !== null ? `Retake ${v.retakePercent}%` : null,
      v.firstTryPercent !== null ? `First try was ${v.firstTryPercent}%` : null,
    ]
      .filter(Boolean)
      .join("   ·   "),
    { font: bold, size: 11, gap: 2 },
  );

  heading("Alerts", v.alerts.length ? red : ink);
  if (!v.alerts.length && !v.flags.length) text("No critical errors or flags.", { color: muted, indent: 10 });
  if (v.alerts.length) {
    text("Critical errors", { font: bold, size: 10, indent: 10, color: red, gap: 2 });
    bullets(v.alerts, red);
  }
  if (v.flags.length) {
    text("Flags", { font: bold, size: 10, indent: 10, gap: 2 });
    bullets(v.flags);
  }

  heading("Trend");
  for (const r of v.trend.rows) {
    if (y - 16 < MARGIN + 16) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    }
    y -= 16;
    const barX = MARGIN + 56;
    const barW = 220;
    page.drawText(pdfText(r.day), { x: MARGIN + 10, y: y + 4, size: 9.5, font: r.current ? bold : regular, color: ink });
    page.drawRectangle({ x: barX, y: y + 3, width: barW, height: 9, color: rgb(0.93, 0.93, 0.93) });
    page.drawRectangle({ x: barX, y: y + 3, width: Math.max(1, (barW * Math.min(100, r.percent)) / 100), height: 9, color: r.current ? blue : green });
    page.drawText(pdfText(`${r.percent}%${r.current ? "  (this quiz)" : ""}`), { x: barX + barW + 8, y: y + 4, size: 9.5, font: r.current ? bold : regular, color: ink });
  }
  y -= 4;
  text(v.trend.direction ? TREND_LINE[v.trend.direction] : "First day: your trend starts after your next quiz.", { font: bold, indent: 10 });

  heading("Coaching tips");
  if (!v.ready) text("Your coaching tips are being written. Check back in a few minutes.", { color: muted, indent: 10 });
  else if (!v.tips.length) text("Nothing to fix: every question got full points.", { color: muted, indent: 10 });
  bullets(v.tips);
  if (v.strengths.length) {
    text("What you did well", { font: bold, size: 10, indent: 10, color: green, gap: 2 });
    bullets(v.strengths);
  }

  const pages = doc.getPages();
  pages.forEach((p, n) =>
    p.drawText(pdfText(`My report · ${v.dayCode}${v.retake ? " retake" : ""} · page ${n + 1} of ${pages.length}`), {
      x: MARGIN,
      y: MARGIN / 2,
      size: 8,
      font: regular,
      color: muted,
    }),
  );
  return doc.save();
}

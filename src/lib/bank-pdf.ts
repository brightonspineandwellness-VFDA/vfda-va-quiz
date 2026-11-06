// The scenario bank as a PDF, answer key included (one day or the whole
// office). Standard Helvetica only, so text goes through pdfText.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { BANK_STATUS_LABELS, rightOption, type BankItem } from "@/lib/bank-export";
import { pdfText } from "@/lib/office-report-pdf";
import { correctResponseToText, LETTERS } from "@/lib/scenario-build";

const PAGE = { width: 612, height: 792 };
const MARGIN = 48;
const WIDTH = PAGE.width - MARGIN * 2;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfText(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export async function bankPdf(input: { officeName: string; title: string; items: BankItem[]; dayTitles: Record<string, string> }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(`${input.officeName}: ${input.title}`));
  doc.setAuthor("VFDA");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);
  const green = rgb(0.08, 0.45, 0.2);
  const red = rgb(0.72, 0.11, 0.11);

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };
  const text = (s: string, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 9.5;
    for (const line of wrap(s, font, size, WIDTH - (o.indent ?? 0))) {
      if (y - size * 1.3 < MARGIN + 16) newPage();
      y -= size * 1.3;
      page.drawText(line, { x: MARGIN + (o.indent ?? 0), y: y + size * 0.3, size, font, color: o.color ?? ink });
    }
    y -= o.gap ?? 1;
  };

  text(`${input.officeName}: ${input.title}`, { font: bold, size: 15, gap: 2 });
  text(`Scenario bank with answers · ${input.items.length} item(s) · ${new Date().toLocaleDateString("en-US", { dateStyle: "medium" })} · not for VAs`, {
    color: muted,
    size: 9,
    gap: 6,
  });

  let day = "";
  for (const i of input.items) {
    if (i.day !== day) {
      day = i.day;
      if (y - 60 < MARGIN + 16) newPage();
      y -= 6;
      text(`${i.day}${input.dayTitles[i.day] ? `: ${input.dayTitles[i.day]}` : ""}`, { font: bold, size: 12, gap: 3 });
    }
    if (y - 70 < MARGIN + 16) newPage();
    text(`${i.code} · version ${i.build_version} · ${i.type} · ${i.points} pt · ${BANK_STATUS_LABELS[i.status]}${i.workflow ? ` · ${i.workflow}` : ""}`, {
      font: bold,
      size: 9.5,
      color: i.status === "needs_review" ? red : ink,
    });
    text(i.stem, { indent: 8 });
    if (i.options) {
      i.options.forEach((o, n) => {
        const right = LETTERS[n] === i.answer;
        text(`${LETTERS[n]}) ${o}${right ? "   <- correct" : ""}`, { indent: 16, color: right ? green : ink, font: right ? bold : regular });
      });
    }
    if (i.type === "mc" && !i.options) text("No options yet", { indent: 16, color: red });
    if (i.type !== "mc" && i.correct_response) {
      text(i.type === "describe" ? "Key points:" : "Required steps / correct response:", { indent: 8, font: bold, size: 9 });
      text(correctResponseToText(i.correct_response), { indent: 16 });
    }
    if (i.type === "mc" && rightOption(i)) text(`Answer: ${rightOption(i)}`, { indent: 8, color: green, size: 9 });
    if (i.critical_fail) text(`Critical fail: ${i.critical_fail}`, { indent: 8, color: red, size: 9 });
    if (i.source_card) text(`Source: ${i.source_card}${i.source_quote ? `: "${i.source_quote}"` : ""}`, { indent: 8, color: muted, size: 8.5, font: italic });
    if (i.repeat) text(`Repeat variant: ${i.repeat.stem}`, { indent: 8, color: muted, size: 8.5 });
    for (const r of i.retakes) text(`Retake version: ${r}`, { indent: 8, color: muted, size: 8.5 });
    y -= 6;
  }

  const pages = doc.getPages();
  pages.forEach((p, n) =>
    p.drawText(pdfText(`Answer key - not for VAs · page ${n + 1} of ${pages.length}`), { x: MARGIN, y: MARGIN / 2, size: 8, font: regular, color: muted }),
  );
  return doc.save();
}

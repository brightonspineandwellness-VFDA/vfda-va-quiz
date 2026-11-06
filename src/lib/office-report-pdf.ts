// The office SOP gap report as a PDF (the page's "Download PDF" and the
// email attachment), from the same blocks as the email (src/lib/office-report.ts).
// Standard Helvetica only, so text is kept to the characters it can show.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { itemLines, reportBlocks, type OfficeReportContent } from "@/lib/office-report";

const PAGE = { width: 612, height: 792 }; // US Letter
const MARGIN = 50;
const WIDTH = PAGE.width - MARGIN * 2;

// Helvetica's WinAnsi encoding: plain quotes, dashes and arrows; anything else dropped.
export function pdfText(s: string) {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/[•▪◦]/g, "-")
    .replace(/✓/g, "ok")
    .replace(/\t/g, " ")
    .normalize("NFKC")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

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
      // A word longer than the line is split.
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

type Line = { text: string; font: PDFFont; size: number; color: ReturnType<typeof rgb>; indent: number };

export async function officeReportPdf(content: OfficeReportContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(`Office SOP gap report: ${content.officeName}`));
  doc.setAuthor("VFDA");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);
  const red = rgb(0.72, 0.11, 0.11);

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };
  const lines = (text: string, font: PDFFont, size: number, color = ink, indent = 0): Line[] =>
    wrap(text, font, size, WIDTH - indent).map((t) => ({ text: t, font, size, color, indent }));
  const draw = (ls: Line[], gapAfter: number, box?: "high" | "normal") => {
    const height = ls.reduce((h, l) => h + l.size * 1.35, 0);
    // Taller than a page: line by line, across pages, without the box.
    if (height > PAGE.height - MARGIN * 2 - 20) {
      for (const l of ls) draw([l], 0);
      y -= gapAfter;
      return;
    }
    if (y - height < MARGIN + 20) newPage();
    if (box) {
      page.drawRectangle({
        x: MARGIN,
        y: y - height - 4,
        width: WIDTH,
        height: height + 8,
        color: box === "high" ? rgb(0.99, 0.93, 0.93) : rgb(0.96, 0.96, 0.96),
        borderWidth: 0,
      });
      page.drawRectangle({ x: MARGIN, y: y - height - 4, width: 3, height: height + 8, color: box === "high" ? red : rgb(0.75, 0.75, 0.75) });
    }
    for (const l of ls) {
      y -= l.size * 1.35;
      page.drawText(l.text, { x: MARGIN + l.indent, y: y + l.size * 0.3, size: l.size, font: l.font, color: l.color });
    }
    y -= gapAfter;
  };

  // A heading stays with what follows it.
  const keepWithNext = (space: number) => {
    if (y - space < MARGIN + 20) newPage();
  };

  for (const b of reportBlocks(content)) {
    switch (b.type) {
      case "title":
        draw(lines(b.text, bold, 16), 6);
        break;
      case "heading":
        y -= 8;
        keepWithNext(90);
        draw(lines(b.text, bold, 13), 4);
        break;
      case "subheading":
        keepWithNext(70);
        draw(lines(b.text, bold, 11, muted), 6);
        break;
      case "muted":
        draw(lines(b.text, regular, 9.5, muted), 4);
        break;
      case "text":
        draw(lines(b.text, regular, 10.5), 4);
        break;
      case "item": {
        const l = itemLines(b.item, b.high);
        const pad = 10;
        draw(
          [
            ...lines(l.title, bold, 10, b.high ? red : ink, pad),
            ...lines(l.vfda, regular, 9.5, ink, pad),
            ...(l.office ? lines(l.office, regular, 9.5, ink, pad) : []),
            ...l.quotes.flatMap((q) => lines(q, italic, 9, muted, pad)),
            ...lines(l.note, regular, 9, muted, pad),
          ],
          10,
          b.high ? "high" : "normal",
        );
        break;
      }
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(pdfText(`VFDA only - not for the doctors · page ${i + 1} of ${pages.length}`), {
      x: MARGIN,
      y: MARGIN / 2,
      size: 8,
      font: regular,
      color: muted,
    }),
  );
  return doc.save();
}

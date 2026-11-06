// VFDA's report as a PDF (the page's "Download PDF" and the email
// attachment): the short brief (src/lib/office-report.ts briefReport), one
// or two pages, bullets only, no quotes. Standard Helvetica only, so text is
// kept to the characters it can show.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { briefReport, type BriefList, type OfficeReportContent } from "@/lib/office-report";

const PAGE = { width: 612, height: 792 }; // US Letter
const MARGIN = 48;
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

export async function officeReportPdf(content: OfficeReportContent): Promise<Uint8Array> {
  const b = briefReport(content);
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(`VFDA report: ${b.officeName}`));
  doc.setAuthor("VFDA");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);
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
    const indent = o.indent ?? 0;
    for (const line of wrap(s, font, size, WIDTH - indent)) {
      if (y - size * 1.3 < MARGIN + 16) newPage();
      y -= size * 1.3;
      page.drawText(line, { x: MARGIN + indent, y: y + size * 0.3, size, font, color: o.color ?? ink });
    }
    y -= o.gap ?? 1;
  };
  // A heading stays with what follows it.
  const heading = (s: string, color = ink) => {
    if (y - 50 < MARGIN + 16) newPage();
    y -= 6;
    text(s, { font: bold, size: 11, color, gap: 2 });
  };
  const bullets = (xs: string[], none: string, color = ink) => {
    if (!xs.length) text(`- ${none}`, { color: muted, indent: 6 });
    for (const x of xs) text(`- ${x}`, { color, indent: 6, size: 9 });
  };
  const more = (l: BriefList) => {
    if (l.more) text(`+${l.more} more on the admin page`, { color: muted, indent: 6, size: 8.5 });
  };

  // Header: office, doctor, date, cards uploaded, counts.
  text(`VFDA report: ${b.officeName}`, { font: bold, size: 15, gap: 3 });
  text(
    [b.doctor ? `Doctor: ${b.doctor}` : null, new Date(b.date).toLocaleDateString("en-US", { dateStyle: "medium" }), "VFDA only - not for the doctor"]
      .filter(Boolean)
      .join("  ·  "),
    { color: muted, size: 9 },
  );
  text(`Cards uploaded (${b.cards.length}): ${b.cards.join(", ") || "none"}`, { color: muted, size: 9, gap: 4 });
  text(`Safety ${b.counts.safety}   ·   Missing ${b.counts.missing}   ·   Different ${b.counts.different}`, { font: bold, size: 10.5, gap: 2 });

  heading("Safety", red);
  bullets(b.safety, "Nothing: no card contradicts or skips red flags, the emergency script, the patient ID check or privacy.", red);
  heading("Missing vs VFDA standard");
  bullets(b.missing.shown, "Nothing missing.");
  more(b.missing);
  heading("Different from VFDA standard");
  bullets(b.different.shown, "Nothing different.");
  more(b.different);
  heading("Missing cards");
  bullets(b.missingCards, "None: the office has a card for every topic.");
  heading("Coaching points for Dr. Matt");
  bullets(b.coaching, "None.");

  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(pdfText(`VFDA only - not for the doctor · page ${i + 1} of ${pages.length}`), { x: MARGIN, y: MARGIN / 2, size: 8, font: regular, color: muted }),
  );
  return doc.save();
}

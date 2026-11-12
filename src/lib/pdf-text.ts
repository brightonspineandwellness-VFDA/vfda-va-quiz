// Text for the PDFs: standard Helvetica (WinAnsi) only, wrapped to a width.

import type { PDFFont } from "pdf-lib";

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

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
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

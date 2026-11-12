// The look of every PDF report (quiz report, My report, VFDA's office
// report): the logo in a white header, section headings with a thin rule,
// Alerts and Notice boxes with colored left borders, large score and label
// badges, a small bar chart, numbered items with their tag, and a footer with
// the page number and "Confidential – VFDA". Colors and sizes come from
// src/lib/theme.ts, the same as the pages. Standard Helvetica only, so text
// goes through pdfText.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { LOGO_JPG_BASE64 } from "@/lib/brand-logo";
import { pdfText, wrap } from "@/lib/pdf-text";
import { colors, LOGO, rgb01, type Tone } from "@/lib/theme";

const PAGE = { width: 612, height: 792 }; // US Letter
const SIDE = 54; // comfortable margins
const TOP = 34;
const LOGO_H = 36;
const HEADER_BOTTOM = PAGE.height - TOP - LOGO_H - 10; // the header's rule
const CONTENT_TOP = HEADER_BOTTOM - 20;
const FOOTER_Y = 30;
const CONTENT_BOTTOM = 62;
export const CONTENT_WIDTH = PAGE.width - SIDE * 2;

const c = (hex: string): RGB => rgb(...rgb01(hex));
const L = colors.light;
export const ink = c(L.foreground);
export const muted = c(L.muted);
export const line = c(L.border);
export const primary = c(L.primary);
export const white = rgb(1, 1, 1);

const TONES: Record<Tone, { fg: RGB; soft: RGB }> = {
  success: { fg: c(L.success), soft: c(L.successSoft) },
  warning: { fg: c(L.warning), soft: c(L.warningSoft) },
  danger: { fg: c(L.danger), soft: c(L.dangerSoft) },
  info: { fg: c(L.info), soft: c(L.infoSoft) },
  neutral: { fg: c(L.muted), soft: c(L.surfaceMuted) },
  primary: { fg: c(L.primary), soft: c(L.primarySoft) },
  accent: { fg: c(L.accent), soft: c(L.accentSoft) },
};
export const toneColor = (t: Tone) => TONES[t].fg;

export type TextStyle = {
  font?: "regular" | "bold";
  size?: number;
  color?: RGB;
  indent?: number;
  gap?: number;
  right?: number;
};

// One paragraph in a box or a numbered item.
export type Para = TextStyle & { text: string };

export class Pdf {
  page!: PDFPage;
  y = CONTENT_TOP;
  private constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    private readonly logo: PDFImage,
    private readonly headerTitle: string,
  ) {
    this.newPage();
  }

  static async create(opts: { title: string; headerTitle: string }) {
    const doc = await PDFDocument.create();
    doc.setTitle(pdfText(opts.title));
    doc.setAuthor("VFDA");
    const [regular, bold, logo] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
      doc.embedJpg(LOGO_JPG_BASE64),
    ]);
    return new Pdf(doc, regular, bold, logo, opts.headerTitle);
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = CONTENT_TOP;
  }

  // Room left on this page, and on an empty page.
  get room() {
    return this.y - CONTENT_BOTTOM;
  }
  static readonly fullPage = CONTENT_TOP - CONTENT_BOTTOM;

  // A new page unless `h` fits on this one.
  ensure(h: number) {
    if (h > this.room && this.y < CONTENT_TOP) this.newPage();
  }

  gap(h: number) {
    this.y -= h;
  }

  font(f: TextStyle["font"]) {
    return f === "bold" ? this.bold : this.regular;
  }

  lineHeight = (size: number) => size * 1.42;

  lines(s: string, o: TextStyle = {}, width = CONTENT_WIDTH) {
    return wrap(s, this.font(o.font), o.size ?? 10, width - (o.indent ?? 0) - (o.right ?? 0));
  }

  heightOf(paras: Para[], width = CONTENT_WIDTH) {
    return paras.reduce((h, p) => h + this.lines(p.text, p, width).length * this.lineHeight(p.size ?? 10) + (p.gap ?? 2), 0);
  }

  // Text that flows across pages. `x0` and `width`: the column (default: the page).
  text(s: string, o: TextStyle = {}, x0 = SIDE, width = CONTENT_WIDTH, decorate?: (top: number, h: number) => void) {
    const size = o.size ?? 10;
    const lh = this.lineHeight(size);
    for (const l of this.lines(s, o, width)) {
      if (lh > this.room) this.newPage();
      decorate?.(this.y, lh);
      this.y -= lh;
      this.page.drawText(l, {
        x: x0 + (o.indent ?? 0),
        y: this.y + size * 0.32,
        size,
        font: this.font(o.font),
        color: o.color ?? ink,
      });
    }
    this.y -= o.gap ?? 2;
  }

  // The title block of page 1: the report's name, then office · VA · date.
  titleBlock(title: string, metaLine: string, badge?: { text: string; tone: Tone }) {
    const size = 18;
    this.y -= size * 1.1;
    this.page.drawText(pdfText(title), {
      x: SIDE,
      y: this.y,
      size,
      font: this.bold,
      color: ink,
    });
    if (badge) this.badge(SIDE + this.bold.widthOfTextAtSize(pdfText(title), size) + 10, this.y - 3, badge.text, badge.tone);
    this.y -= 8;
    this.text(metaLine, { size: 10, color: muted, gap: 10 });
  }

  // A section heading with a thin rule under it, kept with what follows (`keep`).
  heading(s: string, o: { number?: number; color?: RGB; keep?: number } = {}) {
    this.y -= 14;
    this.ensure(o.keep ?? 80);
    const size = 13;
    let x = SIDE;
    if (o.number !== undefined) {
      this.circle(SIDE + 9, this.y - 7, 9, primary);
      const n = String(o.number);
      this.page.drawText(n, {
        x: SIDE + 9 - this.bold.widthOfTextAtSize(n, 9.5) / 2,
        y: this.y - 10.3,
        size: 9.5,
        font: this.bold,
        color: white,
      });
      x += 26;
    }
    this.page.drawText(pdfText(s), {
      x,
      y: this.y - 12,
      size,
      font: this.bold,
      color: o.color ?? ink,
    });
    this.y -= 19;
    this.page.drawLine({
      start: { x: SIDE, y: this.y },
      end: { x: SIDE + CONTENT_WIDTH, y: this.y },
      thickness: 0.6,
      color: line,
    });
    this.y -= 9;
  }

  // A box with a colored left border and a light fill, e.g. Alerts and the
  // VFDA standards notice. Drawn line by line, so a long one can continue on
  // the next page; a short one is never split.
  box(tone: Tone, paras: Para[]) {
    const pad = 10;
    const inner = CONTENT_WIDTH - 4 - pad * 2;
    const h = this.heightOf(paras, inner) + pad * 2;
    if (h <= Pdf.fullPage) this.ensure(h);
    else this.ensure(80);
    const t = TONES[tone];
    const band = (top: number, height: number) => {
      this.page.drawRectangle({
        x: SIDE,
        y: top - height,
        width: CONTENT_WIDTH,
        height,
        color: t.soft,
      });
      this.page.drawRectangle({
        x: SIDE,
        y: top - height,
        width: 4,
        height,
        color: t.fg,
      });
    };
    band(this.y, pad);
    this.y -= pad;
    for (const p of paras) {
      const gap = p.gap ?? 2;
      this.text(p.text, { ...p, gap: 0 }, SIDE + 4 + pad, inner, band);
      if (gap > 0) {
        band(this.y, gap);
        this.y -= gap;
      }
    }
    band(this.y, pad);
    this.y -= pad + 6;
  }

  // A pill badge at (x, baseline y); returns its width.
  badge(x: number, y: number, label: string, tone: Tone, size = 9) {
    const t = TONES[tone];
    const text = pdfText(label);
    const w = this.bold.widthOfTextAtSize(text, size) + size * 1.6;
    const h = size * 1.8;
    this.roundRect(x, y - size * 0.55, w, h, h / 2, t.soft, t.fg);
    this.page.drawText(text, {
      x: x + size * 0.8,
      y: y + size * 0.05,
      size,
      font: this.bold,
      color: t.fg,
    });
    return w;
  }

  // Large badges in a row (score, label, time ...), each with a small caption above.
  badgeRow(items: { caption: string; text: string; tone: Tone }[]) {
    const size = 13;
    this.ensure(48);
    let x = SIDE;
    const captionY = this.y - 10;
    const badgeY = this.y - 34;
    for (const it of items) {
      this.page.drawText(pdfText(it.caption), {
        x,
        y: captionY,
        size: 8.5,
        font: this.regular,
        color: muted,
      });
      const w = this.badge(x, badgeY, it.text, it.tone, size);
      x += Math.max(w, this.regular.widthOfTextAtSize(pdfText(it.caption), 8.5)) + 14;
    }
    this.y -= 52;
  }

  // A small horizontal bar chart: one row per entry, 0-100.
  barChart(
    rows: {
      label: string;
      value: number;
      tone: Tone;
      marker?: number | null;
      note: string;
      bold?: boolean;
    }[],
  ) {
    const rowH = 16;
    const barX = SIDE + 46;
    const barW = 210;
    this.ensure(Math.min(rows.length, 5) * rowH + 6);
    for (const r of rows) {
      if (rowH > this.room) this.newPage();
      this.y -= rowH;
      const base = this.y + 4;
      const font = r.bold ? this.bold : this.regular;
      this.page.drawText(pdfText(r.label), {
        x: SIDE + 2,
        y: base + 1,
        size: 9,
        font,
        color: ink,
      });
      this.roundRect(barX, base - 0.5, barW, 9, 2, c(L.surfaceMuted));
      this.roundRect(barX, base - 0.5, Math.max(3, (barW * Math.min(100, Math.max(0, r.value))) / 100), 9, 2, TONES[r.tone].fg);
      if (r.marker !== null && r.marker !== undefined) {
        this.page.drawRectangle({
          x: barX + (barW * Math.min(100, r.marker)) / 100 - 1,
          y: base - 3,
          width: 2,
          height: 14,
          color: primary,
        });
      }
      this.page.drawText(pdfText(r.note), {
        x: barX + barW + 8,
        y: base + 1,
        size: 9,
        font,
        color: ink,
      });
    }
    this.y -= 6;
  }

  bullets(items: string[], o: TextStyle = {}) {
    for (const b of items) {
      const size = o.size ?? 10;
      const indent = o.indent ?? 4;
      if (this.lineHeight(size) > this.room) this.newPage();
      this.circle(SIDE + indent + 2, this.y - this.lineHeight(size) / 2 - 0.5, 1.6, o.color ?? ink);
      this.text(b, { ...o, indent: indent + 10, gap: o.gap ?? 4 });
    }
  }

  // A numbered item (a coaching tip, a needs-work item): a number circle, a
  // bold title, an optional tag, and its paragraphs. Kept on one page when it fits.
  numberedHeight(title: string, tag: unknown, paras: Para[]) {
    const all: Para[] = [{ text: title, font: "bold", size: 10.5, gap: tag ? 18 : 3 }, ...paras];
    return this.heightOf(all, CONTENT_WIDTH - 26) + 10;
  }

  numbered(n: number, title: string, tag: { text: string; tone: Tone } | null, paras: Para[], titleColor: RGB = ink) {
    const indent = 26;
    const h = this.numberedHeight(title, tag, paras);
    if (h <= Pdf.fullPage) this.ensure(h);
    else this.ensure(90);
    this.y -= 4;
    this.circle(SIDE + 9, this.y - 7, 9, primary);
    const num = String(n);
    this.page.drawText(num, {
      x: SIDE + 9 - this.bold.widthOfTextAtSize(num, 9.5) / 2,
      y: this.y - 10.3,
      size: 9.5,
      font: this.bold,
      color: white,
    });
    this.text(title, {
      font: "bold",
      size: 10.5,
      indent,
      gap: 3,
      color: titleColor,
    });
    if (tag) {
      this.badge(SIDE + indent, this.y - 9, tag.text, tag.tone, 8);
      this.y -= 17;
    }
    for (const p of paras) this.text(p.text, { ...p, indent: indent + (p.indent ?? 0) });
    this.y -= 6;
  }

  // "Label" in small gray bold, then its text.
  field(label: string, value: string, o: { color?: RGB; indent?: number } = {}): Para[] {
    return [
      {
        text: label,
        font: "bold",
        size: 8.5,
        color: muted,
        gap: 0,
        indent: o.indent,
      },
      {
        text: value || "(left empty)",
        size: 9.5,
        color: o.color,
        gap: 4,
        indent: o.indent,
      },
    ];
  }

  private circle(cx: number, cy: number, r: number, color: RGB) {
    this.page.drawCircle({ x: cx, y: cy, size: r, color });
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number, fill: RGB, border?: RGB) {
    const k = Math.min(r, h / 2, w / 2);
    // SVG paths in pdf-lib run down from (x, y): start at the top-left corner.
    const path = `M ${k} 0 H ${w - k} Q ${w} 0 ${w} ${k} V ${h - k} Q ${w} ${h} ${w - k} ${h} H ${k} Q 0 ${h} 0 ${h - k} V ${k} Q 0 0 ${k} 0 Z`;
    this.page.drawSvgPath(path, {
      x,
      y: y + h,
      color: fill,
      borderColor: border,
      borderWidth: border ? 0.6 : 0,
    });
  }

  // The header (logo, the report's name) and the footer on every page.
  async save() {
    const pages = this.doc.getPages();
    const logoW = (LOGO_H * LOGO.width) / LOGO.height;
    const title = pdfText(this.headerTitle);
    pages.forEach((p, n) => {
      p.drawImage(this.logo, {
        x: SIDE,
        y: PAGE.height - TOP - LOGO_H,
        width: logoW,
        height: LOGO_H,
      });
      const tw = this.regular.widthOfTextAtSize(title, 9);
      p.drawText(title, {
        x: PAGE.width - SIDE - tw,
        y: PAGE.height - TOP - LOGO_H / 2 - 3,
        size: 9,
        font: this.regular,
        color: muted,
      });
      p.drawLine({
        start: { x: SIDE, y: HEADER_BOTTOM },
        end: { x: PAGE.width - SIDE, y: HEADER_BOTTOM },
        thickness: 0.6,
        color: line,
      });
      p.drawLine({
        start: { x: SIDE, y: FOOTER_Y + 14 },
        end: { x: PAGE.width - SIDE, y: FOOTER_Y + 14 },
        thickness: 0.5,
        color: line,
      });
      p.drawText("Confidential – VFDA", {
        x: SIDE,
        y: FOOTER_Y,
        size: 8.5,
        font: this.regular,
        color: muted,
      });
      const num = `Page ${n + 1} of ${pages.length}`;
      p.drawText(num, {
        x: PAGE.width - SIDE - this.regular.widthOfTextAtSize(num, 8.5),
        y: FOOTER_Y,
        size: 8.5,
        font: this.regular,
        color: muted,
      });
    });
    return this.doc.save();
  }
}

// The tone of a result label ("Strong", "Needs coaching", "At risk").
export const resultTone = (label: string): Tone => (/strong|pass/i.test(label) ? "success" : /risk|fail/i.test(label) ? "danger" : "warning");

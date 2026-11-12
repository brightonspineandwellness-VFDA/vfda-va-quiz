// VFDA's report as a PDF (the page's "Download PDF" and the email
// attachment): the short brief (src/lib/office-report.ts briefReport), one
// or two pages, bullets only, no quotes. Drawn with src/lib/pdf-kit.ts.

import { briefReport, type BriefList, type OfficeReportContent } from "@/lib/office-report";
import { muted, Pdf, toneColor } from "@/lib/pdf-kit";

// The text helpers live in src/lib/pdf-text.ts; kept here for the files that import them from this one.
export { pdfText, wrap } from "@/lib/pdf-text";

export async function officeReportPdf(content: OfficeReportContent): Promise<Uint8Array> {
  const b = briefReport(content);
  const pdf = await Pdf.create({
    title: `VFDA report: ${b.officeName}`,
    headerTitle: "VFDA only - not for the doctor",
  });
  const red = toneColor("danger");

  const bullets = (xs: string[], none: string, color = undefined as ReturnType<typeof toneColor> | undefined) => {
    if (!xs.length) pdf.text(none, { color: muted, size: 9.5 });
    pdf.bullets(xs, { color, size: 9.5, gap: 2 });
  };
  const more = (l: BriefList) => {
    if (l.more) pdf.text(`+${l.more} more on the admin page`, { color: muted, size: 9 });
  };

  // Header: office, doctor, date, cards uploaded, counts.
  pdf.titleBlock(
    `VFDA report: ${b.officeName}`,
    [`Office: ${b.officeName}`, b.doctor ? `Doctor: ${b.doctor}` : null, new Date(b.date).toLocaleDateString("en-US", { dateStyle: "medium" })]
      .filter(Boolean)
      .join("  ·  "),
    { text: "VFDA ONLY", tone: "primary" },
  );
  pdf.text(`Cards uploaded (${b.cards.length}): ${b.cards.join(", ") || "none"}`, { color: muted, size: 9.5, gap: 4 });
  pdf.badgeRow([
    {
      caption: "Safety",
      text: String(b.counts.safety),
      tone: b.counts.safety ? "danger" : "success",
    },
    {
      caption: "Missing",
      text: String(b.counts.missing),
      tone: b.counts.missing ? "warning" : "success",
    },
    {
      caption: "Different",
      text: String(b.counts.different),
      tone: b.counts.different ? "info" : "success",
    },
  ]);

  pdf.heading("Safety", { number: 1, color: red });
  bullets(b.safety, "Nothing: no card contradicts or skips red flags, the emergency script, the patient ID check or privacy.", red);
  pdf.heading("Missing vs VFDA standard", { number: 2 });
  bullets(b.missing.shown, "Nothing missing.");
  more(b.missing);
  pdf.heading("Different from VFDA standard", { number: 3 });
  bullets(b.different.shown, "Nothing different.");
  more(b.different);
  pdf.heading("Missing cards", { number: 4 });
  bullets(b.missingCards, "None: the office has a card for every topic.");
  pdf.heading("Coaching points for Dr. Matt", { number: 5 });
  bullets(b.coaching, "None.");
  return pdf.save();
}

import "server-only";

// The Call practice report as a PDF, drawn like the quiz report
// (src/lib/quiz-report-pdf.ts) with src/lib/pdf-kit.ts. In order: who and
// when; the label, calls passed and progress toward 25 + 25; Skills [VA]
// showed; Skills to practice (with Office rule / VFDA standard tags); Important
// to review (safety and privacy only); flags; and for the doctor and VFDA:
// coaching ideas.

import { muted, Pdf, resultTone, toneColor, type Para } from "@/lib/pdf-kit";
import type { CallReportContent } from "./report";
import { reportTitle } from "./report";

export async function callReportPdf(r: CallReportContent, audience: "va" | "staff"): Promise<Uint8Array> {
  const first = r.vaName.trim().split(/\s+/)[0] || "Your VA";
  const pdf = await Pdf.create({
    title: `${reportTitle(r)} - ${r.vaName}`,
    headerTitle: "Call Practice Report",
  });
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

  pdf.titleBlock(
    "Call Practice Report",
    [r.officeName, r.doctors.length ? r.doctors.join(", ") : null, `VA: ${r.vaName}`, `Calls ${r.firstCall}–${r.lastCall}`, `${day(r.from)} – ${day(r.to)}`]
      .filter(Boolean)
      .join("  ·  "),
  );
  pdf.badgeRow([
    { caption: "Result", text: r.label, tone: resultTone(r.label) },
    { caption: "These 10 calls", text: `${r.stats.passed} of ${r.stats.calls} passed`, tone: "primary" },
    { caption: "Easy calls", text: `${r.progress.easy} of ${r.progress.goal}`, tone: "neutral" },
    { caption: "Challenging calls", text: `${r.progress.challenging} of ${r.progress.goal}`, tone: "neutral" },
  ]);
  if (r.summary) pdf.text(r.summary, { size: 10.5 });

  pdf.heading(audience === "va" ? "Skills you showed" : `Skills ${first} showed`, { keep: 60, color: toneColor("success") });
  if (!r.skills.length) pdf.text("Skills show up here as they build.", { color: muted });
  else pdf.checkChips(r.skills);

  pdf.heading("Skills to practice", { keep: 60 });
  if (!r.practice.length) pdf.text("Nothing this time: keep doing what you're doing.", { color: muted });
  r.practice.forEach((p, n) =>
    pdf.numbered(n + 1, p.text, p.source ? { text: p.source, tone: p.source === "VFDA standard" ? "info" : "neutral" } : null, []),
  );

  if (r.important.length) {
    const paras: Para[] = [
      { text: "Important to review", font: "bold", size: 11, color: toneColor("warning"), gap: 2 },
      { text: `${r.important.length} safety or privacy item${r.important.length === 1 ? "" : "s"}`, size: 9.5, color: muted, gap: 4 },
      ...r.important.flatMap((i) => [
        { text: `"${i.quote}"`, size: 10, gap: 1 },
        { text: i.why, size: 9.5, color: muted, gap: 3 },
      ]),
    ];
    pdf.box("warning", paras);
  }

  if (r.flags.length) {
    pdf.box("neutral", [{ text: "Flags", font: "bold", size: 10.5, gap: 2 }, ...r.flags.map((f) => ({ text: f, size: 9.5, gap: 2 }))]);
  }

  if (audience === "staff" && r.coaching.length) {
    pdf.heading(`Coaching ideas for ${first}`, { keep: 50 });
    pdf.bullets(r.coaching, { size: 10, gap: 2 });
  }
  return pdf.save();
}

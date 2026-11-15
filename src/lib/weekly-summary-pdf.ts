// The Friday weekly summary PDF for the doctor (src/lib/weekly-summary.ts):
// the week's quizzes and results, the skills the VA showed, the office's
// cards vs. VFDA standard for the week (what isn't on a card yet, all in one
// place), and a few things worth a quick practice. Proof that training is
// happening, in one page. Warm, never shaming. Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, resultTone, toneColor } from "@/lib/pdf-kit";
import type { CardTested } from "@/lib/quiz-report";
import { sourcesSection } from "@/lib/quiz-report-pdf";

export type WeeklySummary = {
  vaName: string;
  officeName: string;
  doctors: string[];
  weekLabel: string; // "Nov 9 – Nov 13, 2026"
  days: { code: string; topic: string; result: string; percent: number; retake: boolean }[];
  // Training days finished so far, this week included.
  totalDone: number;
  strengths: string[];
  cardsTested: CardTested[];
  standards: string[];
  practice: string[];
};

export const weeklyFileName = (s: Pick<WeeklySummary, "vaName" | "weekLabel">) =>
  `Weekly summary - ${s.vaName} - ${s.weekLabel}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");

export async function weeklySummaryPdf(s: WeeklySummary): Promise<Uint8Array> {
  const pdf = await Pdf.create({ title: `Weekly training summary: ${s.vaName}`, headerTitle: "Weekly training summary" });
  pdf.titleBlock(
    `Weekly summary: ${s.vaName}`,
    [`Office: ${s.officeName}`, s.doctors.length ? `${s.doctors.length > 1 ? "Doctors" : "Doctor"}: ${s.doctors.join(", ")}` : null, s.weekLabel]
      .filter(Boolean)
      .join("  ·  "),
  );
  pdf.badgeRow([
    { caption: "Quizzes this week", text: String(s.days.length), tone: "primary" },
    { caption: "Training days done", text: String(s.totalDone), tone: "accent" },
  ]);

  pdf.heading("This week's training", { keep: 60 });
  if (!s.days.length) pdf.text("No quizzes this week.", { color: muted });
  for (const d of s.days) {
    pdf.ensure(24);
    pdf.text(`${d.code}${d.retake ? " (retake)" : ""}: ${d.topic}`, { font: "bold", size: 10.5, gap: 1 });
    pdf.text(`${d.result} · ${d.percent}%`, { size: 9.5, color: toneColor(resultTone(d.result)), indent: 8, gap: 5 });
  }

  pdf.heading("Skills shown this week", { keep: 60, color: toneColor("success") });
  if (!s.strengths.length) pdf.text("They show up here as the VA's reports are made.", { color: muted });
  else pdf.bullets(s.strengths, { size: 10, gap: 2 });

  sourcesSection(pdf, s, { when: "this week's" });

  pdf.heading("Worth a quick practice", { keep: 60 });
  if (!s.practice.length) pdf.text("Nothing stood out this week. Keep it going.", { color: muted });
  else {
    pdf.text("Ask your VA to show you these at your next check-in. No teaching needed, just \"show me how you...\".", { size: 9.5, color: muted, gap: 3 });
    pdf.bullets(s.practice, { size: 10, gap: 2 });
  }
  return pdf.save();
}

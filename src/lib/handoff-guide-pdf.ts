// The handoff "show me" guide PDF for the doctor (src/lib/handoff-guide.ts):
// how to run the twice-a-week check-ins of the first month, the office's
// cards vs. VFDA standard over the whole training, then one page-ish per
// meeting: 3-4 skills, each with Show me / Why / What could go wrong / Best
// practices to check, and a line for what the office does differently.
// A mix of strengths, skills still building and VFDA standards not on the
// cards. Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, toneColor } from "@/lib/pdf-kit";
import type { CardTested } from "@/lib/quiz-report";
import { sourcesSection } from "@/lib/quiz-report-pdf";
import type { Tone } from "@/lib/theme";

export type GuideMix = "strength" | "building" | "not_on_cards";

export type GuideSkill = {
  title: string; // "Rescheduling a patient by phone"
  card: string; // the card to look at, or "VFDA standard"
  mix: GuideMix;
  showMe: string;
  why: string;
  couldGoWrong: string;
  bestPractices: string[];
};

export type HandoffGuide = {
  vaName: string;
  officeName: string;
  doctors: string[];
  date: string; // ISO
  daysDone: number;
  meetings: { title: string; skills: GuideSkill[] }[];
  cardsTested: CardTested[];
  standards: string[];
};

export const MIX_LABEL: Record<GuideMix, { text: string; tone: Tone }> = {
  strength: { text: "Strength", tone: "success" },
  building: { text: "Still building", tone: "warning" },
  not_on_cards: { text: "Not on your cards yet", tone: "info" },
};

export const guideFileName = (g: Pick<HandoffGuide, "vaName">) => `Show-me guide - ${g.vaName}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");

export async function handoffGuidePdf(g: HandoffGuide): Promise<Uint8Array> {
  const pdf = await Pdf.create({ title: `Show-me training guide: ${g.vaName}`, headerTitle: "Show-me training guide" });
  pdf.titleBlock(
    `Show-me guide: ${g.vaName}`,
    [
      `Office: ${g.officeName}`,
      g.doctors.length ? `${g.doctors.length > 1 ? "Doctors" : "Doctor"}: ${g.doctors.join(", ")}` : null,
      new Date(g.date).toLocaleDateString("en-US", { dateStyle: "medium" }),
    ]
      .filter(Boolean)
      .join("  ·  "),
  );
  pdf.text(
    `${g.vaName} finished all ${g.daysDone} training days. This guide is for your check-ins during the first month: two short meetings a week, where your VA shows you what they know.`,
    { size: 10.5, gap: 6 },
  );

  pdf.box("primary", [
    { text: "How to run each check-in (15-20 minutes)", font: "bold", size: 10.5, color: toneColor("primary"), gap: 3 },
    ...[
      "1. Don't teach anything new. Ask your VA to show you, on screen, how they do it.",
      "2. Ask the follow-ups: why they do it that way, and what could go wrong.",
      "3. Check what you see against the best practices listed for that skill.",
      "4. Anything your office does differently? Write it on the line and add it to the Trello card.",
    ].map((t) => ({ text: t, size: 9.5, indent: 4, gap: 2 })),
    {
      text: "Each meeting mixes skills your VA already does well, skills still building, and VFDA standards that aren't on your cards yet.",
      size: 9.5,
      color: muted,
      gap: 0,
    },
  ]);

  sourcesSection(pdf, g, { when: "the training's" });

  g.meetings.forEach((m, n) => {
    if (n > 0 || pdf.y < 380) pdf.newPage();
    pdf.heading(`Meeting ${n + 1}${m.title ? `: ${m.title}` : ""}`, { number: n + 1, keep: 120 });
    m.skills.forEach((s, i) => {
      pdf.numbered(i + 1, s.title, MIX_LABEL[s.mix], [
        { text: `Card: ${s.card}`, size: 8.5, color: muted, gap: 3 },
        ...pdf.field("SHOW ME", s.showMe),
        ...pdf.field("WHY DID YOU DO IT THAT WAY?", s.why),
        ...pdf.field("WHAT COULD GO WRONG?", s.couldGoWrong),
        { text: "BEST PRACTICES TO CHECK", font: "bold", size: 8.5, color: muted, gap: 0 },
        ...s.bestPractices.map((b) => ({ text: `[ ] ${b}`, size: 9.5, indent: 4, gap: 1 })),
        { text: "How we do it here: _______________________________________________", size: 9.5, color: muted, gap: 2 },
      ]);
    });
  });

  pdf.box("neutral", [
    { text: "After the first month", font: "bold", size: 10.5, gap: 2 },
    {
      text: "Every \"how we do it here\" line belongs on a Trello card. Once it's on the card, VFDA's training and your VA follow your way.",
      size: 9.5,
      gap: 0,
    },
  ]);
  return pdf.save();
}

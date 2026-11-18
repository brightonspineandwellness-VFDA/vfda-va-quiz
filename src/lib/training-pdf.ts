// The training program's PDFs, in the VFDA look (src/lib/pdf-kit.ts), never
// a score:
// - the Training Sheet for one session (at most 2 pages): 1. What you'll go
//   through, 2. the 30-minute agenda, 3. five scenarios to ask the VA (with
//   "Listen for", a follow-up and the card to review), 4. wrap-up;
// - "[VA] – Training overview (4-week plan)": what the VA knows, what to
//   practice (safety first), and the plan.

import { muted, Pdf, toneColor } from "@/lib/pdf-kit";
import type { Bank, FocusArea, Sheet, Strength } from "@/lib/training-plan";
import { sundayText } from "@/lib/week";

export type SheetContext = {
  vaName: string;
  officeName: string;
  doctor: string;
  number: number;
  week: number;
  focus: FocusArea;
  strength: Strength;
  sheet: Sheet;
};

const first = (name: string) => name.trim().split(/\s+/)[0] || "your VA";
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

export const sheetFileName = (c: Pick<SheetContext, "number" | "vaName" | "sheet">) =>
  safeName(`Session ${c.number} – ${c.sheet.title} – ${first(c.vaName)}.pdf`);
export const overviewFileName = (vaName: string) => safeName(`${first(vaName)} – Training overview (4-week plan).pdf`);

// "Based on: ..." with the VFDA standards it used, and what to do if the office differs.
export function basedOnText(c: Pick<SheetContext, "focus" | "vaName">) {
  const cards = c.focus.cards.length ? c.focus.cards.map((x) => `${x}${/card$/i.test(x) ? "" : " card"}`).join(", ") : "your office's cards";
  const std = c.focus.standards.length ? ` · VFDA standard: ${c.focus.standards.join("; ")}` : "";
  const tell = c.focus.standards.length ? ` If your office does this differently, tell ${first(c.vaName)} today and correct it.` : "";
  return `Based on: ${cards}${std}.${tell}`;
}

async function drawSheet(c: SheetContext, k: number): Promise<{ bytes: Uint8Array; pages: number }> {
  const va = first(c.vaName);
  const sz = (n: number) => n * k;
  const pdf = await Pdf.create({
    title: `Training Sheet: ${c.sheet.title} - ${c.vaName}`,
    headerTitle: "VA Training Sheet · 30 minutes",
    footer: "Confidential – VFDA · Fake patient names only",
  });
  pdf.titleBlock(c.sheet.title, `${c.officeName}  ·  ${c.doctor} with ${c.vaName}  ·  Week ${c.week} · Session ${c.number} of 8`, c.focus.safety ? { text: "Safety", tone: "danger" } : undefined);
  pdf.text(`Build on: ${c.sheet.buildOn}`, { size: sz(10.5), color: toneColor("success"), font: "bold", gap: 2 });

  pdf.heading("What you'll go through", { number: 1, keep: 50 });
  pdf.text(c.sheet.summary, { size: sz(10), gap: 4 });
  pdf.box("info", [{ text: basedOnText(c), size: sz(9.5) }]);

  pdf.heading("Agenda", { number: 2, keep: 50 });
  const agenda: [string, string][] = [
    ["5 min", `Explain: ${c.sheet.explain.join(" ")}`],
    ["20 min", "Ask the 5 scenarios below (about 4 minutes each)."],
    ["5 min", "Wrap-up questions and notes."],
  ];
  for (const [t, a] of agenda) {
    pdf.text(`${t}   ${a}`, { size: sz(9.5), gap: 2 });
  }

  pdf.heading(`Scenarios to ask ${va}`, { number: 3, keep: 60 });
  pdf.text(`Read the scenario out loud and let ${va} talk it through. Use "Listen for" to check the answer.`, { size: sz(9), color: muted, gap: 4 });
  c.sheet.scenarios.forEach((s, n) => {
    pdf.numbered(
      n + 1,
      `Ask: "${s.ask.replace(/^"|"$/g, "")}"`,
      s.kind === "focus" ? { text: "Practice", tone: "warning" } : { text: "Builds on a strength", tone: "success" },
      [
        { text: "Listen for", font: "bold", size: sz(8.5), color: muted, gap: 0 },
        ...s.listenFor.map((l) => ({ text: `- ${l}`, size: sz(9), gap: 0, indent: 4 })),
        { text: `Follow-up: "${s.followUp.replace(/^"|"$/g, "")}"`, size: sz(9), gap: 0 },
        { text: `Review: ${s.card}`, size: sz(8.5), color: muted, gap: 0 },
      ],
    );
  });

  pdf.heading("Wrap-up", { number: 4, keep: 70 });
  c.sheet.wrapUp.forEach((q) => pdf.text(`- "${q.replace(/^"|"$/g, "")}"`, { size: sz(9.5), gap: 2 }));
  pdf.gap(4);
  pdf.text("Notes: ________________________________________________________________", { size: sz(9.5), gap: 6 });
  pdf.text("Session done:  [  ]      Date: ______________", { size: sz(10), font: "bold", gap: 2 });
  const bytes = await pdf.save();
  return { bytes, pages: pdf.doc.getPageCount() };
}

// At most 2 pages: drawn smaller when the content runs longer.
export async function trainingSheetPdf(c: SheetContext): Promise<Uint8Array> {
  let out = await drawSheet(c, 1);
  for (const k of [0.92, 0.85, 0.78]) {
    if (out.pages <= 2) break;
    out = await drawSheet(c, k);
  }
  return out.bytes;
}

export type OverviewContext = {
  vaName: string;
  officeName: string;
  doctor: string;
  bank: Bank;
  sessions: { number: number; week: number; sendOn: string | null; focus: string; safety: boolean; strength: string }[];
};

export async function trainingOverviewPdf(c: OverviewContext): Promise<Uint8Array> {
  const va = first(c.vaName);
  const pdf = await Pdf.create({ title: `${c.vaName} - Training overview (4-week plan)`, headerTitle: "Training overview · 4-week plan" });
  pdf.titleBlock(`${va}'s training plan`, `${c.officeName}  ·  ${c.doctor} with ${c.vaName}  ·  Quiz days: ${c.bank.daysDone} of ${c.bank.daysTotal} completed`);
  pdf.text(
    `8 sessions of 30 minutes, 2 a week. Each pairs one thing to practice with one thing ${va} already does well, so it's 50/50. Sheets arrive by email every Sunday night.`,
    { size: 10, gap: 6 },
  );

  pdf.heading(`What ${va} knows`, { keep: 60, color: toneColor("success") });
  c.bank.knows.forEach((k) => pdf.text(`- ${k.text}  (${[k.day, k.card].filter(Boolean).join(" · ")})`, { size: 9.5, gap: 2 }));

  pdf.heading(`What ${va} needs to practice`, { keep: 60 });
  c.bank.practice.forEach((p, n) =>
    pdf.numbered(n + 1, p.title, p.safety ? { text: "Safety", tone: "danger" } : null, [
      { text: p.text, size: 9.5, gap: 1 },
      { text: [p.cards.join(", "), p.days.join(", ")].filter(Boolean).join(" · "), size: 8.5, color: muted, gap: 0 },
    ]),
  );

  pdf.heading("Your 4-week plan (30 minutes, twice a week)", { keep: 120 });
  for (let w = 1; w <= 4; w++) {
    const week = c.sessions.filter((s) => s.week === w);
    if (!week.length) continue;
    pdf.text(`Week ${w}${week[0].sendOn ? ` · sheets arrive ${sundayText(week[0].sendOn)}` : ""}`, { font: "bold", size: 10, gap: 1 });
    for (const s of week) pdf.text(`Session ${s.number}: ${s.focus}${s.safety ? " (Safety)" : ""}  ·  builds on: ${s.strength}`, { size: 9.5, indent: 10, gap: 1 });
    pdf.gap(3);
  }

  if (c.bank.notCovered) pdf.box("neutral", [{ text: "Not covered yet", font: "bold", size: 10, gap: 2 }, { text: c.bank.notCovered, size: 9.5 }]);
  pdf.box("info", [{ text: `When a session is done, click "Mark session done" in the app so VFDA can follow along.`, size: 9.5 }]);
  return pdf.save();
}

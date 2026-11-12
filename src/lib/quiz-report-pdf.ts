// The quiz report PDF (src/lib/quiz-report.ts): header, score and label,
// the Alerts box, the VFDA standards notice, the trend, "Needs work" one
// numbered block per item (critical errors first, marked), "What they did
// well" and the coaching tips given to the VA. One to three pages: when the
// blocks don't fit, the last ones are left out with "+N more on the attempt
// page". Drawn with src/lib/pdf-kit.ts.

import { muted, Pdf, resultTone, toneColor, type Para } from "@/lib/pdf-kit";
import { evaluationText, type QuizReport } from "@/lib/quiz-report";
import { minutesText } from "@/lib/report";
import { STANDARDS_NOTICE, tipTagOf, tipTagText, type TipTag } from "@/lib/rule-source";

const MAX_PAGES = 3;
// Long scenarios and answers are cut so one item never fills a page.
const MAX_SCENARIO = 600;
const MAX_ANSWER = 700;

const cut = (s: string, n: number) => {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

const tagBadge = (t: TipTag | null | undefined) =>
  t
    ? {
        text: tipTagText(t),
        tone: t.kind === "vfda_standard" ? ("info" as const) : ("neutral" as const),
      }
    : null;

export async function quizReportPdf(r: QuizReport): Promise<Uint8Array> {
  for (let shown = r.needsWork.length; ; shown--) {
    const pdf = await draw(r, shown);
    if (pdf.doc.getPageCount() <= MAX_PAGES || shown === 0) return pdf.save();
  }
}

async function draw(r: QuizReport, shown: number) {
  const pdf = await Pdf.create({
    title: `Quiz report: ${r.vaName} - ${r.dayCode}${r.retake ? " (retake)" : ""}`,
    headerTitle: `Quiz report · ${r.dayCode}${r.retake ? " retake" : ""}`,
  });
  const red = toneColor("danger");

  // Header: who, where, when; then the score and label as large badges.
  pdf.titleBlock(
    `Quiz report: ${r.vaName}`,
    [
      `Office: ${r.officeName}`,
      r.doctors.length ? `${r.doctors.length > 1 ? "Doctors" : "Doctor"}: ${r.doctors.join(", ")}` : null,
      `VA: ${r.vaName}`,
      new Date(r.date).toLocaleDateString("en-US", { dateStyle: "medium" }),
    ]
      .filter(Boolean)
      .join("  ·  "),
    r.retake ? { text: "RETAKE", tone: "accent" } : undefined,
  );
  pdf.text(`${r.dayCode}: ${r.topic}`, { font: "bold", size: 11, gap: 4 });
  const percent = r.maxPoints ? Math.round((r.points * 100) / r.maxPoints) : 0;
  pdf.badgeRow([
    {
      caption: r.retake ? "Retake score" : "First-try score",
      text: `${percent}%  (${r.points}/${r.maxPoints})`,
      tone: "primary",
    },
    { caption: "Result", text: r.resultLabel, tone: resultTone(r.resultLabel) },
    { caption: "Time spent", text: minutesText(r.timeSpent), tone: "neutral" },
  ]);

  // Alerts: red when anything is in it.
  const { critical, flags } = r.alerts;
  if (!critical.length && !flags.length) {
    pdf.box("neutral", [
      {
        text: "Alerts: No critical errors or flags",
        font: "bold",
        size: 10.5,
        color: muted,
      },
    ]);
  } else {
    const paras: Para[] = [
      {
        text: `Alerts: ${critical.length} critical error${critical.length === 1 ? "" : "s"}${flags.length ? `, ${flags.length} flag${flags.length === 1 ? "" : "s"}` : ""}`,
        font: "bold",
        size: 11,
        color: red,
        gap: 4,
      },
    ];
    for (const c of critical) {
      paras.push(
        {
          text: `CRITICAL · ${c.code} · ${c.topic}`,
          font: "bold",
          size: 9.5,
          color: red,
          gap: 1,
        },
        {
          text: `VA's words: "${cut(c.quote, 300)}"`,
          size: 9.5,
          indent: 8,
          color: red,
          gap: 1,
        },
        {
          text: `Why it's critical: ${cut(c.why, 300)}`,
          size: 9.5,
          indent: 8,
          gap: 1,
        },
        { text: `Coaching: ${c.coaching}`, size: 9.5, indent: 8, gap: 5 },
      );
    }
    if (flags.length) {
      paras.push({ text: "Flags", font: "bold", size: 9.5, gap: 1 });
      for (const f of flags) paras.push({ text: `- ${f}`, size: 9.5, indent: 8, gap: 1 });
    }
    pdf.box("danger", paras);
  }

  // The rules checked against a VFDA standard because the cards didn't cover them.
  if (r.standards.length) {
    pdf.box("info", [
      {
        text: STANDARDS_NOTICE.title,
        font: "bold",
        size: 11,
        color: toneColor("info"),
        gap: 3,
      },
      { text: STANDARDS_NOTICE.doctor, size: 9.5, gap: 4 },
      ...r.standards.map((s) => ({
        text: `- ${s}`,
        size: 9.5,
        indent: 6,
        gap: 1,
      })),
    ]);
  }

  // Trend: a bar per day taken (first try, retake as a navy tick), the
  // direction with the change since the first day, and repeat success.
  pdf.heading("Trend");
  const t = r.trend;
  if (!t.rows.length) pdf.text("No training day taken yet.", { color: muted });
  pdf.barChart(
    t.rows.map((row) => ({
      label: row.day,
      value: row.percent,
      tone: resultTone(row.label),
      marker: row.retakePercent,
      bold: row.current,
      note: `${row.percent}% ${row.label}${row.retakePercent !== null ? `  ·  retake ${row.retakePercent}%${row.retakeLabel ? ` ${row.retakeLabel}` : ""}` : ""}${row.current ? "  (this report)" : ""}`,
    })),
  );
  const first = t.rows[0];
  pdf.text(
    t.direction && t.change !== null && first
      ? `${t.direction.charAt(0).toUpperCase()}${t.direction.slice(1)}: ${t.change > 0 ? "+" : ""}${t.change} pts since the first day (${first.day} ${first.percent}% -> ${t.rows[t.rows.length - 1].percent}%).`
      : "First day: no trend yet.",
    { font: "bold", size: 9.5, gap: 2 },
  );
  const rate = (s: { right: number; total: number }) => `${s.right} of ${s.total}${s.total ? ` (${Math.round((s.right * 100) / s.total)}%)` : ""}`;
  pdf.text(
    `Repeat success: ${t.repeats.quiz.total ? `${rate(t.repeats.quiz)} missed questions right on the second try in this quiz` : "no repeats in this quiz"}; ${rate(t.repeats.soFar)} so far.`,
    { size: 9.5, gap: 2 },
  );
  pdf.text("Bars: first-try score per day (green Strong, amber Needs coaching, red At risk); navy tick: retake score.", { size: 8.5, color: muted });

  const blocks = r.needsWork.slice(0, shown).map((i) => ({
    i,
    title: `${i.critical ? "CRITICAL ERROR · " : ""}${i.code} · ${i.workflowName}`,
    tag: tagBadge(tipTagOf(i.ruleSource, i.sourceCard)),
    paras: [
      ...pdf.field("Scenario", cut(i.scenario, MAX_SCENARIO)),
      ...pdf.field("VA's answer (exact words)", cut(i.answer, MAX_ANSWER)),
      ...pdf.field(
        "Evaluation",
        [
          evaluationText(i),
          ...i.missed.map((m) => `Missed: ${m}`),
          ...(i.critical && i.criticalQuote ? [`Critical, in the VA's words: "${i.criticalQuote}"`] : []),
        ].join("\n"),
        { color: i.critical ? red : undefined },
      ),
      ...pdf.field("Coaching tip for the VA", i.coaching),
      ...pdf.field("Trello card tip for the doctor", i.cardTip),
    ],
  }));
  // The heading stays with the first item.
  const firstH = blocks[0] ? pdf.numberedHeight(blocks[0].title, blocks[0].tag, blocks[0].paras) : 0;
  pdf.heading("Needs work", { keep: Math.min(Pdf.fullPage, 40 + firstH) });
  if (!r.needsWork.length) pdf.text("Nothing: every item got full points.", { color: muted });
  blocks.forEach(({ i, title, tag, paras }, n) => pdf.numbered(n + 1, title, tag, paras, i.critical ? red : undefined));
  if (shown < r.needsWork.length)
    pdf.text(`+${r.needsWork.length - shown} more on the attempt page`, {
      color: muted,
      size: 9.5,
    });

  pdf.heading("What they did well", { keep: 50 });
  if (!r.strengths.length) pdf.text("No item got full points this time.", { color: muted });
  for (const s of r.strengths) {
    pdf.ensure(30);
    pdf.text(`${s.workflow} ${s.name}`, { font: "bold", size: 10, gap: 1 });
    pdf.bullets(s.bullets, { size: 9.5, gap: 2 });
    pdf.gap(3);
  }

  // Exactly what the VA sees on My report (written for the VA, no scenarios or answers).
  pdf.heading("Coaching tips given to the VA", { keep: 60 });
  if (!r.vaTips) pdf.text("Not written yet: they appear here once the VA's report is made.", { color: muted });
  else {
    if (r.vaTips.alerts.length) {
      pdf.text("Critical errors, as the VA sees them", {
        font: "bold",
        size: 10,
        gap: 1,
        color: red,
      });
      pdf.bullets(r.vaTips.alerts, { size: 9.5, color: red, gap: 2 });
      pdf.gap(4);
    }
    if (!r.vaTips.tips.length)
      pdf.text("None: every item got full points.", {
        size: 9.5,
        color: muted,
      });
    r.vaTips.tips.forEach((tip, n) => pdf.numbered(n + 1, `Coaching tip ${n + 1}`, tagBadge(r.vaTips?.tags?.[n]), [{ text: tip, size: 9.5 }]));
    if (r.vaTips.strengths.length) {
      pdf.ensure(30);
      pdf.text("What they did well", {
        font: "bold",
        size: 10,
        gap: 1,
        color: toneColor("success"),
      });
      pdf.bullets(r.vaTips.strengths, { size: 9.5, gap: 2 });
    }
  }
  return pdf;
}

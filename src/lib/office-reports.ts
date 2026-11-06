import "server-only";

// The office SOP gap report on the server (VFDA only; doctors never see it).
// Written once the cards are read (and again after any re-import), and on
// demand. Claude checks each workflow step against the office's cards (word
// matching with AI_MODE=mock, or when Claude fails) and writes the coaching
// points. The full report (with quotes) is on the admin page; the email to
// VFDA_REPORT_EMAIL only carries the short brief with its PDF attached, and
// Slack a 3-line summary. What went out is kept on the office_reports row.

import { z } from "zod";
import { aiErrorMessage, aiMode, askStructured } from "@/lib/ai";
import { isMustAsk, quoteIn, topicDays } from "@/lib/card-map";
import { CARD_CHECKLIST } from "@/lib/doctor-flow";
import { applyMustAskFallbacks } from "@/lib/must-ask";
import { directAnswer, doctorCardAnswer, slotApplies, type RuleRow } from "@/lib/doctor-flow";
import { applies, profileFromAnswers } from "@/lib/interview";
import { loadOfficeSetup } from "@/lib/interview-data";
import {
  briefLines,
  briefReport,
  briefSubject,
  buildFindings,
  escapeHtml,
  fallbackCoaching,
  missingCardItems,
  reportCounts,
  reportSlack,
  sameText,
  wordMatch,
  type CheckVerdict,
  type Checkpoint,
  type OfficeReportContent,
  type ReportCard,
  type RuleVerdict,
  type StandardInput,
  versionId,
} from "@/lib/office-report";
import { officeReportPdf } from "@/lib/office-report-pdf";
import { appUrl, officeDoctors, postSlack, sendEmail, tryTwice, vfdaEmails } from "@/lib/reports";
import { placeholderValues, ruleText, type DerivedPlaceholder } from "@/lib/scenario-build";
import { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export const reportLink = (officeId: string, reportId?: string) =>
  `${appUrl()}/admin/offices/${officeId}/report${reportId ? `?r=${reportId}` : ""}`;

// Card text sent to Claude, per card and in all.
const CARD_CHARS = 15_000;
const ALL_CARD_CHARS = 200_000;

// ---------------------------------------------------------------------------
// What the report compares
// ---------------------------------------------------------------------------

async function loadInputs(db: Db, officeId: string) {
  const setup = await loadOfficeSetup(officeId, db as never);
  if (!setup) return null;
  const [workflowsRes, slotsRes, daysRes, derivedRes, docsRes] = await Promise.all([
    db.from("workflows").select("code, name, steps, immediate_escalation").order("position"),
    db.from("rule_slots").select("key, workflows, default_answer"),
    db.from("schedule_days").select("code, condition, workflows"),
    db.from("settings").select("value").eq("key", "derived_placeholders").maybeSingle(),
    db
      .from("office_documents")
      .select("id, file_name, card_name, card_title, extracted_text, skip, imported_at")
      .eq("office_id", officeId)
      .eq("kind", "card")
      .not("imported_at", "is", null)
      .order("created_at"),
  ]);
  const { interview, rules, missingCards } = setup;
  const profile = profileFromAnswers(interview.answers);
  const dayConditions = Object.fromEntries(interview.quizzes.map((q) => [q.code, q.condition]));
  const flow = { dayConditions, conditions: interview.conditions, profile };

  // The workflows on this office's training days.
  const days = (must(daysRes) ?? []) as { code: string; condition: string; workflows: string[] | null }[];
  const onPath = new Set(days.filter((d) => applies(d.condition, interview.conditions, profile)).flatMap((d) => d.workflows ?? []));
  const workflows = ((must(workflowsRes) ?? []) as { code: string; name: string; steps: string[]; immediate_escalation: string[] }[]).filter(
    (w) => onPath.has(w.code),
  );
  const nameOf = new Map(workflows.map((w) => [w.code, w.name]));

  // The office's own values fill the steps' {PLACEHOLDERS} where known.
  const accepted = rules.filter((r) => r.status === "accepted" || (r.source === "card_import" && r.status === "needs_doctor"));
  const values = placeholderValues(accepted, ((must(derivedRes)?.value ?? []) as DerivedPlaceholder[]), officeId);
  const fill = (s: string) => s.replace(/\{([A-Z0-9_]+)\}/g, (m, k: string) => values[k] ?? m);
  const checkpoints: Checkpoint[] = workflows.flatMap((w) => [
    ...(w.steps ?? []).map((t, i) => ({ id: `step:${w.code}:${i + 1}`, workflow: w.code, workflowName: w.name, label: `Step ${i + 1}`, text: fill(t), escalation: false })),
    ...(w.immediate_escalation ?? []).map((t, i) => ({
      id: `escalation:${w.code}:${i + 1}`,
      workflow: w.code,
      workflowName: w.name,
      label: `Immediate escalation ${i + 1}`,
      text: fill(t),
      escalation: true,
    })),
  ]);

  // The VFDA standards and the must-ask rules, with what the office has.
  const slotExtra = new Map(((must(slotsRes) ?? []) as { key: string; workflows: string[] | null; default_answer: unknown }[]).map((s) => [s.key, s]));
  const docName = new Map(((must(docsRes) ?? []) as { id: string; card_title: string; card_name: string; file_name: string }[]).map((d) => [d.id, d.card_title || d.card_name || d.file_name]));
  const rowsOf = (key: string) => rules.filter((r) => r.rule_slot_key === key);
  const standards: StandardInput[] = interview.questions
    .filter((s) => (s.tier === "default" || (s.tier === "doctor" && isMustAsk(s.key))) && s.answer_type !== "matrix" && slotApplies(s, flow))
    .map((s) => {
      const rows = rowsOf(s.key);
      const extra = slotExtra.get(s.key);
      const standard = ruleText(s.suggested_answer ?? extra?.default_answer ?? null) || null;
      const cardRows = rows.filter((r) => r.source === "card_import" && (r.status === "accepted" || r.status === "needs_doctor"));
      const fromCard = doctorCardAnswer(s, rows);
      const typed = directAnswer(s, rows);
      const doctor: StandardInput["doctor"] = fromCard
        ? { text: ruleText(fromCard.rule), card: docName.get(fromCard.source_document_id ?? "") ?? "VA Office Rules", quote: fromCard.source_quote }
        : typed
          ? { text: ruleText(typed.rule), card: null, quote: null }
          : null;
      return {
        key: s.key,
        question: s.question,
        mustAsk: s.tier === "doctor",
        workflows: (extra?.workflows ?? []).filter((c) => nameOf.has(c)).map((c) => ({ code: c, name: nameOf.get(c)! })),
        standard,
        cardVersions: cardRows.map((r: RuleRow) => ({
          text: ruleText(r.rule),
          card: docName.get(r.source_document_id ?? "") ?? r.document_name ?? "a card",
          quote: r.source_quote,
          partial: r.partial,
        })),
        doctor,
      };
    });

  const docs = (must(docsRes) ?? []) as { id: string; file_name: string; card_name: string; card_title: string; extracted_text: string | null; skip: boolean }[];
  const cards: ReportCard[] = docs
    .filter((d) => !d.skip && (d.extracted_text ?? "").trim())
    .map((d) => ({ id: d.id, title: d.card_title || d.card_name || d.file_name, text: d.extracted_text ?? "" }));
  const onPathDays = new Set(days.filter((d) => applies(d.condition, interview.conditions, profile)).map((d) => d.code));
  return {
    officeName: interview.office.name,
    checkpoints,
    standards,
    cards,
    allCards: docs.map((d) => d.card_title || d.card_name || d.file_name),
    noCardTopics: CARD_CHECKLIST.map((t) => t.name).filter((n) => !setup.documents.some((d) => d.card_name === n)),
    missingCards: missingCardItems(
      missingCards.map((m) => ({ name: m.card_name, days: topicDays(m.card_name).filter((d) => onPathDays.has(d)), markedBy: m.marked_by_name ?? null })),
    ),
  };
}

type Inputs = NonNullable<Awaited<ReturnType<typeof loadInputs>>>;

// The rule versions to compare with the standard: each card's own, and the
// doctor's VA Office Rules card.
const comparable = (s: StandardInput) =>
  s.standard
    ? [
        ...s.cardVersions.map((v) => ({ id: versionId(s.key, v.card), text: v.text })),
        ...(s.doctor?.card ? [{ id: versionId(s.key, s.doctor.card), text: s.doctor.text }] : []),
      ]
    : [];

// ---------------------------------------------------------------------------
// Claude: steps against the cards, rule versions against the standards
// ---------------------------------------------------------------------------

const SYSTEM = `You compare a chiropractic office's own Trello cards (how it trains its virtual assistant) with VFDA's
standard workflows and rules. Be exact and fair: a step is covered only when a card actually tells the VA to do it,
even in other words. Never invent card content; quotes are copied word for word from the card named.`;

const CompareSchema = z.object({
  checkpoints: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["covered", "partial", "missing", "conflict"]),
      card: z.string().nullable().describe("The card title it is found on, exactly as listed"),
      quote: z.string().nullable().describe("The card's exact words (under 300 characters)"),
      card_says: z.string().nullable().describe("For partial or conflict: what the card says, in short plain words"),
    }),
  ),
  rules: z.array(z.object({ key: z.string().describe("The rule version id, exactly as listed (KEY|card)"), verdict: z.enum(["same", "different"]) })),
});

async function compareWithClaude(inputs: Inputs) {
  let budget = ALL_CARD_CHARS;
  const cardBlock = inputs.cards
    .map((c) => {
      const text = c.text.slice(0, Math.max(0, Math.min(CARD_CHARS, budget)));
      budget -= text.length;
      return `## ${c.title}\n${text}`;
    })
    .join("\n\n");
  const rules = inputs.standards.flatMap((s) => comparable(s).map((v) => ({ s, v })));
  const text = `For each checkpoint (a step or immediate-escalation rule of a VFDA workflow), say whether the office's
cards cover it: covered, partial (only part of it), missing, or conflict (a card says to do something different).
For covered, partial and conflict, name the card and quote it. Answer every checkpoint id.

Then for each rule version (one per card; compare each with the standard only, never two cards with each other),
say whether it means the same as the VFDA standard ("same": the same
instruction, even in other words or with the office's own names and details filled in) or something different
("different": a different time, channel, limit, person or step).

<cards>
${cardBlock || "(no cards with text)"}
</cards>

<checkpoints>
${inputs.checkpoints.map((c) => `- ${c.id} (${c.workflow} ${c.workflowName}): ${c.text}`).join("\n")}
</checkpoints>

<rules>
${rules.map(({ s, v }) => `- ${v.id}: ${s.question}\n  VFDA standard: ${s.standard}\n  Card: ${v.text}`).join("\n") || "(none)"}
</rules>`;
  const out = await askStructured(CompareSchema, { system: SYSTEM, effort: "medium", maxTokens: 64000, content: [{ type: "text", text }] });
  const byTitle = new Map(inputs.cards.map((c) => [c.title, c]));
  const verdicts = new Map<string, CheckVerdict>();
  for (const v of out.checkpoints) {
    if (!inputs.checkpoints.some((c) => c.id === v.id)) continue;
    const card = v.card ? byTitle.get(v.card) : undefined;
    // A quote that isn't on the card it names is dropped.
    const quote = card && v.quote && quoteIn(v.quote, card.text) ? v.quote.trim().slice(0, 300) : null;
    verdicts.set(v.id, { status: v.status, card: card?.title ?? null, quote, cardSays: v.card_says?.trim() || null });
  }
  // Anything Claude left out is checked by words.
  for (const c of inputs.checkpoints) if (!verdicts.has(c.id)) verdicts.set(c.id, wordMatch(c, inputs.cards));
  const ruleVerdicts = new Map<string, RuleVerdict>();
  for (const r of out.rules) ruleVerdicts.set(r.key, r.verdict);
  for (const { s, v } of rules) if (!ruleVerdicts.has(v.id)) ruleVerdicts.set(v.id, sameText(v.text, s.standard!) ? "same" : "different");
  return { verdicts, ruleVerdicts };
}

function compareByWords(inputs: Inputs) {
  const verdicts = new Map(inputs.checkpoints.map((c) => [c.id, wordMatch(c, inputs.cards)] as const));
  const ruleVerdicts = new Map<string, RuleVerdict>();
  for (const s of inputs.standards) for (const v of comparable(s)) ruleVerdicts.set(v.id, sameText(v.text, s.standard!) ? "same" : "different");
  return { verdicts, ruleVerdicts };
}

const CoachingSchema = z.object({ points: z.array(z.string()).describe("3 to 5 coaching points") });

async function coachingWithClaude(officeName: string, findings: ReturnType<typeof buildFindings>, missingCards: { label: string; note: string }[]) {
  const line = (i: { kind: string; workflow: string | null; label: string; vfda: string; office: string | null }) =>
    `- [${i.kind}${i.workflow ? ` ${i.workflow}` : ""}] ${i.label}. VFDA: ${i.vfda}${i.office ? ` Cards: ${i.office}` : ""}`;
  const text = `Dr. Matt (VFDA) will talk with the doctor of ${officeName} about gaps between the office's cards and
VFDA's standards. Write 3 to 5 coaching points for that conversation: plain language, one or two sentences each,
most important first (safety first), each saying what to discuss and what to change on the cards. Base them only on
the findings below.

Safety first (high priority):
${findings.safety.map(line).join("\n") || "(none)"}

Missing cards (the office has no card; VFDA standards are used):
${missingCards.map((c) => `- ${c.label}. ${c.note}`).join("\n") || "(none)"}

Missing:
${findings.missing.flatMap((g) => g.items).slice(0, 40).map(line).join("\n") || "(none)"}

Conflicts:
${findings.conflicts.slice(0, 20).map(line).join("\n") || "(none)"}

Partial:
${findings.partial.slice(0, 20).map(line).join("\n") || "(none)"}`;
  const out = await askStructured(CoachingSchema, {
    system: "You help VFDA coach chiropractic offices on how their VA follows the office's procedures.",
    effort: "low",
    maxTokens: 8000,
    content: [{ type: "text", text }],
  });
  const points = out.points.map((p) => p.trim()).filter(Boolean);
  if (points.length < 3) throw new Error("fewer than 3 coaching points");
  return points.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Writing, saving and sending
// ---------------------------------------------------------------------------

export async function buildOfficeReport(db: Db, officeId: string): Promise<OfficeReportContent | null> {
  // Must-ask rules no card covers use VFDA's suggestion before they're compared.
  await applyMustAskFallbacks(officeId).catch((e) => console.error("Must-ask defaults not set", officeId, e));
  const inputs = await loadInputs(db, officeId);
  if (!inputs) return null;
  const live = aiMode() !== "mock";
  let warning: string | null = live ? null : "AI_MODE=mock: steps were checked by word matching, not Claude.";
  let method: OfficeReportContent["method"] = "word_match";
  let compared = compareByWords(inputs);
  if (live) {
    try {
      compared = await compareWithClaude(inputs);
      method = "claude";
    } catch (e) {
      warning = `Claude couldn't check the steps (${aiErrorMessage(e).slice(0, 160)}); word matching was used instead.`;
    }
  }
  const findings = buildFindings({ checkpoints: inputs.checkpoints, standards: inputs.standards, ...compared });
  let coaching = fallbackCoaching(findings, inputs.missingCards);
  if (live) {
    try {
      coaching = await coachingWithClaude(inputs.officeName, findings, inputs.missingCards);
    } catch (e) {
      console.error("Coaching points not written by Claude", officeId, e);
    }
  }
  return {
    officeName: inputs.officeName,
    primaryDoctor: (await officeDoctors(db, officeId)).primary,
    generatedAt: new Date().toISOString(),
    cards: inputs.allCards,
    method,
    warning,
    ...findings,
    missingCards: inputs.missingCards,
    noCardTopics: inputs.noCardTopics,
    coaching,
  };
}

export type ReportReason = "review" | "reimport" | "manual";

// Writes a new report, saves it and sends it. Returns its id.
export async function generateOfficeReport(officeId: string, reason: ReportReason, by: string | null = null): Promise<string | null> {
  const db = createAdminClient();
  const content = await buildOfficeReport(db, officeId);
  if (!content) return null;
  const row = must(
    await db
      .from("office_reports")
      .insert({ office_id: officeId, reason, content, counts: reportCounts(content), created_by: by })
      .select("id")
      .single(),
  ) as { id: string };
  await sendOfficeReport(row.id);
  return row.id;
}

// Email (VFDA_REPORT_EMAIL only, never the doctor) with the PDF, and a short
// Slack summary. Only what hasn't gone out yet is sent.
export async function sendOfficeReport(reportId: string): Promise<{ emailError: string | null; slackError: string | null }> {
  const db = createAdminClient();
  const row = must(
    await db.from("office_reports").select("id, office_id, content, emailed_at, slack_at").eq("id", reportId).maybeSingle(),
  ) as { id: string; office_id: string; content: OfficeReportContent; emailed_at: string | null; slack_at: string | null } | null;
  if (!row) return { emailError: "Report not found.", slackError: null };
  const link = reportLink(row.office_id, row.id);
  const patch: Record<string, unknown> = {};
  let emailError: string | null = null;
  let slackError: string | null = null;

  if (!row.emailed_at) {
    const to = [...new Set(vfdaEmails().map((e) => e.toLowerCase()))];
    if (!to.length) emailError = "VFDA_REPORT_EMAIL isn't set.";
    else {
      const pdf = Buffer.from(await officeReportPdf(row.content)).toString("base64");
      const filename = `VFDA report - ${row.content.officeName.replace(/[^\w .-]+/g, "")}.pdf`;
      const brief = briefReport(row.content);
      const lines = briefLines(brief, link);
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111">${lines
        .map((l) => (!l ? "" : /^[A-Z .]+$/.test(l) ? `<h3 style="margin:16px 0 4px;font-size:14px">${escapeHtml(l)}</h3>` : `<p style="margin:2px 0">${escapeHtml(l)}</p>`))
        .join("")}<p style="margin-top:16px;color:#666">The PDF is attached. VFDA only: never for the doctor.</p></div>`;
      for (const address of to) {
        const error = await tryTwice(() =>
          sendEmail(address, briefSubject(brief), html, lines.join("\n"), `office-report-${row.id}-${address}`, [{ filename, content: pdf }]),
        );
        if (error) emailError = `${address}: ${error}`;
      }
    }
    patch.email_error = emailError?.slice(0, 500) ?? null;
    if (!emailError) patch.emailed_at = new Date().toISOString();
  }
  if (!row.slack_at) {
    slackError = await tryTwice(() => postSlack(reportSlack(row.content, link)));
    patch.slack_error = slackError?.slice(0, 500) ?? null;
    if (!slackError) patch.slack_at = new Date().toISOString();
  }
  if (Object.keys(patch).length) must(await db.from("office_reports").update(patch).eq("id", row.id));
  if (emailError || slackError) console.error("Office report not fully sent", reportId, emailError, slackError);
  return { emailError, slackError };
}

// Called when the cards have been read (rules apply at once; nothing waits for
// review). Writes a report when no report was written since the cards were
// last read.
export async function reportIfDue(officeId: string, by: string | null = null): Promise<string | null> {
  const db = createAdminClient();
  const office = must(
    await db.from("offices").select("extraction_status, extracted_at").eq("id", officeId).maybeSingle(),
  ) as { extraction_status: string; extracted_at: string | null } | null;
  if (office?.extraction_status !== "done") return null;
  const latest = await db.from("office_reports").select("created_at").eq("office_id", officeId).order("created_at", { ascending: false }).limit(1);
  const last = must(latest)?.[0]?.created_at as string | undefined;
  if (last && office.extracted_at && Date.parse(last) >= Date.parse(office.extracted_at)) return null;
  return generateOfficeReport(officeId, last ? "reimport" : "review", by);
}

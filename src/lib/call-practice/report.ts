import "server-only";

// The Call practice report: one for every 10 graded practice calls of a VA
// at an office (calls 1-10, 11-20, ...), in the quiz report's format and
// tone (src/lib/quiz-report.ts): a label, Skills [VA] showed (the biggest
// section), Skills to practice, Important to review (safety and privacy
// only), flags, then for the doctor and VFDA only: coaching ideas. No
// scores; the pass count of the 10 calls is shown, as on the Call practice page.
//
// Claude Opus 5.5 reads each call's graded checklist and feedback (not the
// transcripts) and writes the sections. Built after a call is graded
// (src/app/api/calls/[id]/finish, in after()), stored in call_reports.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { officeDoctors } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import type { CallFeedback, CallFlag, ChecklistLine } from "./grade";
import { effectiveResult, GOAL, summarize, loadCallsFor } from "./progress";
import { CALL_TYPE_LABELS, goalBucket, ROLEPLAY_TITLES, type CallType, type Roleplay } from "./types";

type Db = ReturnType<typeof createAdminClient>;

const MODEL = "claude-opus-5-5";
export const CALLS_PER_REPORT = 10;

export type CallReportContent = {
  sequence: number;
  firstCall: number; // 1, 11, 21, ...
  lastCall: number; // 10, 20, 30, ...
  vaName: string;
  officeName: string;
  doctors: string[];
  from: string;
  to: string;
  label: "On track" | "Building skills" | "Let's review together";
  stats: { calls: number; easy: number; challenging: number; passed: number; critical: number };
  progress: { easy: number; challenging: number; goal: number };
  summary: string; // 1-2 sentences to the VA
  skills: string[]; // Skills shown
  practice: { text: string; source: "Office rule" | "VFDA standard" | null }[];
  important: { quote: string; why: string }[];
  flags: string[];
  coaching: string[]; // doctor / VFDA only
};

export type CallReportRow = {
  id: string;
  va_id: string;
  office_id: string;
  sequence: number;
  created_at: string;
  content: CallReportContent;
};

type GradedRow = {
  id: string;
  call_type: CallType;
  roleplay: Roleplay | null;
  result: "passed" | "practice_again" | null;
  override_result: "passed" | "practice_again" | null;
  checklist: ChecklistLine[] | null;
  feedback: (CallFeedback & { critical_quote?: string | null }) | null;
  flags: CallFlag[] | null;
  started_at: string;
  finished_at: string | null;
};

const ReportSchema = z.object({
  summary: z.string().describe("1-2 warm sentences to the VA (\"you\") about these 10 calls: the overall picture and the one thing that matters most next"),
  skills: z
    .array(z.string())
    .describe("4-8 specific skills the VA showed across these calls, most consistent first, each a short phrase starting with a verb (\"Greets callers with the office script\")"),
  practice: z
    .array(
      z.object({
        text: z.string().describe("What to practice, phrased as what to do, one sentence"),
        cadence_key: z.string().nullable().describe("When this is about a scheduling cadence rule: its key exactly as given; otherwise null"),
      }),
    )
    .describe("1-5 skills to practice, most important (most often missed, or safety) first"),
  coaching: z
    .array(z.string())
    .describe("2-4 coaching ideas for the DOCTOR to use with this VA, practical and short (a quick roleplay, a script line to review, a card to update)"),
});

const SYSTEM = `You write the Call practice report for a virtual assistant (VA) at a chiropractic office. The VA practiced phone calls with an AI playing made-up patients; each call was graded with a phone checklist and a scheduling cadence check.

Write in the style of the office's quiz reports: warm, specific and encouraging, never shaming. No scores or points. Base everything on patterns across the calls: something that happened once matters less than something that happened in several calls. Use plain words a busy doctor and a VA can act on.`;

const labelFor = (passed: number, calls: number, critical: number): CallReportContent["label"] =>
  critical > 0 ? "Let's review together" : passed / calls >= 0.7 ? "On track" : passed / calls >= 0.4 ? "Building skills" : "Let's review together";

function callSummary(c: GradedRow, n: number) {
  const title = c.roleplay ? `${CALL_TYPE_LABELS[c.call_type]}: ${ROLEPLAY_TITLES[c.roleplay]}` : CALL_TYPE_LABELS[c.call_type];
  const missed = (c.checklist ?? [])
    .filter((l) => l.status === "missed")
    .map((l) => `${l.kind === "cadence" ? `cadence ${l.item} (${l.source ?? ""})` : l.item}: ${l.note}`);
  return [
    `Call ${n} - ${title} - ${effectiveResult(c) === "passed" ? "Passed" : "Practice again"}`,
    missed.length ? `Missed: ${missed.join(" | ")}` : "Missed: nothing",
    `Went well: ${(c.feedback?.went_well ?? []).join(" | ")}`,
    `Try next: ${(c.feedback?.try_next ?? []).join(" | ")}`,
    c.feedback?.critical_quote ? `Safety/privacy issue, VA said: "${c.feedback.critical_quote}"` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function writeReport(calls: GradedRow[], cadenceKeys: { key: string; label: string }[]) {
  const content = `Cadence rule keys: ${cadenceKeys.map((c) => `${c.key} (${c.label})`).join(", ")}

${calls.map((c, i) => callSummary(c, i + 1)).join("\n\n")}`;
  const client = new Anthropic();
  const message = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(ReportSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content }],
    })
    .finalMessage();
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens" || !message.parsed_output) {
    throw new Error("The call report couldn't be written.");
  }
  return message.parsed_output as z.infer<typeof ReportSchema>;
}

// Build every report this VA is due at this office (normally the one just
// reached). Safe to run twice: (va, office, sequence) is unique.
export async function makeDueCallReports(vaId: string, officeId: string, db: Db = createAdminClient()): Promise<number> {
  const { data } = await db
    .from("practice_calls")
    .select("id, call_type, roleplay, result, override_result, checklist, feedback, flags, started_at, finished_at")
    .eq("va_id", vaId)
    .eq("office_id", officeId)
    .eq("status", "finished")
    .order("finished_at", { ascending: true });
  const graded = ((data ?? []) as GradedRow[]).filter((c) => effectiveResult(c));
  const due = Math.floor(graded.length / CALLS_PER_REPORT);
  if (!due) return 0;

  const { data: have } = await db.from("call_reports").select("sequence").eq("va_id", vaId).eq("office_id", officeId);
  const done = new Set(((have ?? []) as { sequence: number }[]).map((r) => r.sequence));
  // At most the two latest missing reports per run.
  const missing = Array.from({ length: due }, (_, i) => i + 1).filter((s) => !done.has(s)).slice(-2);
  if (!missing.length) return 0;

  const [va, office, doctors, standards, all] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", vaId).maybeSingle(),
    db.from("offices").select("name").eq("id", officeId).maybeSingle(),
    officeDoctors(db, officeId).catch(() => ({ list: [] as { email: string; name: string }[] })),
    db.from("call_cadence_standards").select("rule_key, label").order("sort_order"),
    loadCallsFor(db, { vaIds: [vaId] }),
  ]);
  const vaRow = va.data as { full_name: string | null; email: string } | null;
  const cadenceKeys = ((standards.data ?? []) as { rule_key: string; label: string }[]).map((s) => ({ key: s.rule_key, label: s.label }));
  const totals = summarize(all.filter((c) => c.office_id === officeId));
  const doctorNames = doctors.list.map((d) => d.name).filter(Boolean);

  let made = 0;
  for (const seq of missing) {
    const calls = graded.slice((seq - 1) * CALLS_PER_REPORT, seq * CALLS_PER_REPORT);
    const written = await writeReport(calls, cadenceKeys);

    const passed = calls.filter((c) => effectiveResult(c) === "passed").length;
    const important = calls
      .filter((c) => c.feedback?.critical_quote)
      .map((c) => ({
        quote: c.feedback!.critical_quote!,
        why: "Safety and privacy come first: verify who's calling before sharing details, and send red-flag symptoms to the doctor.",
      }));
    const flagged = calls.filter((c) => (c.flags ?? []).length).length;
    const sourceOf = (key: string | null): CallReportContent["practice"][number]["source"] => {
      if (!key) return null;
      const line = calls.flatMap((c) => c.checklist ?? []).find((l) => l.kind === "cadence" && l.item === cadenceKeys.find((k) => k.key === key)?.label);
      return line?.source?.startsWith("VFDA") ? "VFDA standard" : line ? "Office rule" : null;
    };

    const content: CallReportContent = {
      sequence: seq,
      firstCall: (seq - 1) * CALLS_PER_REPORT + 1,
      lastCall: seq * CALLS_PER_REPORT,
      vaName: vaRow?.full_name?.trim() || vaRow?.email || "VA",
      officeName: (office.data as { name: string } | null)?.name ?? "",
      doctors: doctorNames,
      from: calls[0].finished_at ?? calls[0].started_at,
      to: calls[calls.length - 1].finished_at ?? calls[calls.length - 1].started_at,
      label: labelFor(passed, calls.length, important.length),
      stats: {
        calls: calls.length,
        easy: calls.filter((c) => goalBucket(c.call_type) === "easy").length,
        challenging: calls.filter((c) => goalBucket(c.call_type) === "challenging").length,
        passed,
        critical: important.length,
      },
      progress: { easy: Math.min(totals.easy.finished, GOAL), challenging: Math.min(totals.challenging.finished, GOAL), goal: GOAL },
      summary: written.summary.trim(),
      skills: written.skills.slice(0, 8),
      practice: written.practice.slice(0, 5).map((p) => ({ text: p.text, source: sourceOf(p.cadence_key) })),
      important,
      flags: flagged ? [`${flagged} call${flagged === 1 ? "" : "s"} had details that looked like real patient information. Practice calls should only use made-up details.`] : [],
      coaching: written.coaching.slice(0, 4),
    };

    const { error } = await db.from("call_reports").insert({
      va_id: vaId,
      office_id: officeId,
      sequence: seq,
      call_ids: calls.map((c) => c.id),
      first_call_at: calls[0].started_at,
      last_call_at: calls[calls.length - 1].finished_at ?? calls[calls.length - 1].started_at,
      content,
    });
    if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
    if (!error) made++;
  }
  return made;
}

export const REPORT_COLUMNS = "id, va_id, office_id, sequence, created_at, content";

export async function loadReportsFor(db: Db, filter: { vaIds?: string[]; officeIds?: string[] }): Promise<CallReportRow[]> {
  let q = db.from("call_reports").select(REPORT_COLUMNS).order("created_at", { ascending: false }).limit(500);
  if (filter.vaIds) q = q.in("va_id", filter.vaIds.length ? filter.vaIds : ["00000000-0000-0000-0000-000000000000"]);
  if (filter.officeIds) q = q.in("office_id", filter.officeIds.length ? filter.officeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) return []; // table missing (migration not run yet) = no reports
  return (data ?? []) as CallReportRow[];
}

export const reportTitle = (r: Pick<CallReportContent, "firstCall" | "lastCall">) => `Call practice report: calls ${r.firstCall}–${r.lastCall}`;

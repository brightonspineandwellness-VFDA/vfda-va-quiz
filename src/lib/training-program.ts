import "server-only";

// The training bank and the 4-week doctor training program
// (src/lib/training-plan.ts has the pure parts).
//
// When: once the VA has submitted every scheduled quiz day: W2D5, or, when
// W2D5 isn't in their schedule (no gray cards, or outside their role), their
// last scheduled day, with every other scheduled day submitted too. It's
// built from ALL of the VA's quiz days (first tries, repeats, retakes,
// critical errors, flags): the training bank (src/lib/ai.ts), the 8 sessions,
// and one Training Sheet per session. Nothing is sent when it's built; the
// Sunday-night cron sends it (src/lib/training-send.ts). VFDA's "Generate
// training program now" builds it at once for testing, and says which days
// are missing.

import { aiErrorMessage, aiMode, askTrainingBank, askTrainingSheet } from "@/lib/ai";
import { loadItems } from "@/lib/quiz-reports";
import { cardOf } from "@/lib/quiz-report";
import { officeDoctors } from "@/lib/reports";
import { loadOfficesTz } from "@/lib/offices-tz";
import { skillsOf } from "@/lib/skills";
import { createAdminClient } from "@/lib/supabase/server";
import {
  checkBank,
  checkSheet,
  fallbackBank,
  fallbackSheet,
  notCoveredText,
  overallLabel,
  planSessions,
  scenarioOrder,
  type Bank,
  type BankItem,
  type FocusArea,
  type PlannedSession,
  type Sheet,
  type Strength,
} from "@/lib/training-plan";
import { loadVaPath, type VaPath } from "@/lib/training-progress";
import { officeRulesFor } from "@/lib/va-training";
import { resultLabel, type DayRow } from "@/lib/va-flow";
import { addDays, localParts, sundayAfter, zoneOf } from "@/lib/week";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || "your VA";

// The day that starts the program when it's in the VA's schedule.
export const TRIGGER_DAY = "W2D5";

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type Readiness = {
  path: VaPath;
  done: number;
  total: number;
  missing: DayRow[];
  // The day whose submission starts it: W2D5, or the last scheduled day.
  triggerDay: string | null;
  ready: boolean;
};

export function readinessOf(path: VaPath): Readiness {
  const missing = path.path.filter((d) => !path.firstTry.has(d.code));
  const triggerDay = path.path.some((d) => d.code === TRIGGER_DAY) ? TRIGGER_DAY : (path.path.at(-1)?.code ?? null);
  return {
    path,
    done: path.path.length - missing.length,
    total: path.path.length,
    missing,
    triggerDay,
    ready: path.path.length > 0 && !missing.length,
  };
}

export async function loadReadiness(db: Db, vaId: string, officeId: string) {
  return readinessOf(await loadVaPath(db, vaId, officeId));
}

// ---------------------------------------------------------------------------
// Stored programs
// ---------------------------------------------------------------------------

export type ProgramRow = {
  id: string;
  va_id: string;
  office_id: string;
  status: "building" | "ready" | "running" | "done" | "failed";
  trigger: "auto" | "test";
  missing_days: string[];
  bank: Bank | null;
  start_sunday: string | null;
  error: string | null;
  built_at: string | null;
  created_at: string;
};

export type SessionRow = {
  id: string;
  program_id: string;
  number: number;
  week: number;
  send_on: string | null;
  focus: FocusArea;
  strength: Strength;
  sheet: Sheet | null;
  status: "scheduled" | "sent" | "done";
  sent_at: string | null;
  done_at: string | null;
  done_note: string | null;
  edited_at: string | null;
};

const PROGRAM_COLUMNS = "id, va_id, office_id, status, trigger, missing_days, bank, start_sunday, error, built_at, created_at";
const SESSION_COLUMNS = "id, program_id, number, week, send_on, focus, strength, sheet, status, sent_at, done_at, done_note, edited_at";

// Null when there's none, or before training-program.sql has been run (`missingTable`).
export async function loadProgram(db: Pick<Db, "from">, vaId: string, officeId: string) {
  const res = await db.from("training_programs").select(PROGRAM_COLUMNS).eq("va_id", vaId).eq("office_id", officeId).maybeSingle();
  if (res.error) return { program: null, sessions: [] as SessionRow[], missingTable: /training_programs/.test(res.error.message) };
  const program = res.data as ProgramRow | null;
  if (!program) return { program: null, sessions: [] as SessionRow[], missingTable: false };
  const sessions = (must(await db.from("training_sessions").select(SESSION_COLUMNS).eq("program_id", program.id).order("number")) ?? []) as SessionRow[];
  return { program, sessions, missingTable: false };
}

// ---------------------------------------------------------------------------
// The input: every quiz day
// ---------------------------------------------------------------------------

type Context = {
  vaName: string;
  vaFirst: string;
  officeName: string;
  doctor: string;
  timeZone: string;
  items: BankItem[];
  cards: string[];
  skills: { day: string; text: string; card: string }[];
  bankText: string;
  labels: string[];
  notCovered: string | null;
};

async function loadContext(db: Db, vaId: string, officeId: string, r: Readiness): Promise<Context> {
  const [va, [office], doctors, sequence, allDays] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", vaId).maybeSingle(),
    loadOfficesTz(db, [officeId]),
    officeDoctors(db, officeId),
    db.from("settings").select("value").eq("key", "sequence").maybeSingle(),
    db.from("schedule_days").select("code, title"),
  ]);
  const vaName = (must(va)?.full_name || must(va)?.email || "VA") as string;
  const vaFirst = firstNameOf(vaName);
  const titleOf = new Map(((must(allDays) ?? []) as { code: string; title: string }[]).map((d) => [d.code, d.title]));
  const attempts = r.path.attempts;
  const items: BankItem[] = [];
  const lines: string[] = [];
  const skills: Context["skills"] = [];
  const cards = new Set<string>();
  const labels: string[] = [];

  for (const a of attempts) {
    const label =
      a.kind === "day" ? a.schedule_day : a.kind === "retake" ? `${a.schedule_day} practiced again` : a.kind === "recheck" ? "Recheck" : "Retrain";
    if (a.kind === "day") labels.push(resultLabel(a.result));
    const [{ needsWork, doneWell }, repeats, report] = await Promise.all([
      loadItems(db, a.id),
      db.from("attempt_items").select("position, repeat_scenario_id, repeat_score, fast, paste_log").eq("attempt_id", a.id),
      db.from("va_reports").select("strengths, tips, alerts").eq("attempt_id", a.id).maybeSingle(),
    ]);
    const rep = new Map(((repeats.data ?? []) as { position: number; repeat_scenario_id: string | null; repeat_score: number | null }[]).map((x) => [String(x.position), x]));
    const flags = ((repeats.data ?? []) as { fast: boolean; paste_log: unknown }[]).reduce(
      (n, x) => ({ fast: n.fast + (x.fast ? 1 : 0), pasted: n.pasted + (Array.isArray(x.paste_log) && x.paste_log.length ? 1 : 0) }),
      { fast: 0, pasted: 0 },
    );
    lines.push(
      `<quiz day="${label}" topic="${titleOf.get(a.schedule_day) ?? ""}" result="${resultLabel(a.result)}"${a.critical_errors ? ` critical_errors="${a.critical_errors}"` : ""}${flags.fast ? ` fast_answers="${flags.fast}"` : ""}${flags.pasted ? ` pasted_answers="${flags.pasted}"` : ""}>`,
    );
    for (const d of doneWell) {
      const card = d.sourceCard?.trim() || `${d.workflowName} card`;
      cards.add(card);
      items.push({
        ref: `${label}#ok${items.length}`,
        day: a.schedule_day,
        workflow: d.workflow,
        workflowName: d.workflowName,
        card,
        topic: d.partTitle || d.workflowName,
        critical: false,
        missed: [],
        correct: d.correct,
        standards: d.ruleSource?.kind === "vfda_standard" ? d.ruleSource.rules : [],
        full: true,
        repeatFixed: false,
      });
      lines.push(`<done_well workflow="${d.workflowName}" card="${card}" topic="${d.partTitle}">${d.didWell ?? ""}</done_well>`);
    }
    for (const i of needsWork) {
      const card = cardOf(i);
      cards.add(card);
      const r2 = rep.get(i.key);
      const repeat = r2?.repeat_scenario_id ? (r2.repeat_score !== null && r2.repeat_score >= 2 ? "fully correct on the one more try" : "still below full points on the one more try") : "";
      const ref = `${label}#${i.key}`;
      items.push({
        ref,
        day: a.schedule_day,
        workflow: i.workflow,
        workflowName: i.workflowName,
        card,
        topic: i.partTitle || i.workflowName,
        critical: i.critical,
        missed: i.missed,
        correct: i.correct,
        standards: i.ruleSource?.kind === "vfda_standard" ? i.ruleSource.rules : [],
        full: false,
        repeatFixed: repeat.startsWith("fully"),
      });
      lines.push(
        `<needs_work ref="${ref}" workflow="${i.workflowName}" card="${card}" topic="${i.partTitle}"${i.critical ? ' critical="true"' : ""}${
          i.ruleSource?.kind === "vfda_standard" ? ` vfda_standard="${i.ruleSource.rules.join("; ")}"` : ""
        }>
<scenario>${i.scenario.slice(0, 600)}</scenario>
<steps>${i.correct.join("; ")}</steps>
<to_practice>${i.missed.join("; ") || i.reason}</to_practice>
<did_well>${i.didWell}</did_well>
${repeat ? `<repeat>${repeat}</repeat>` : ""}${i.critical && i.criticalFail ? `\n<critical_because>${i.criticalFail}</critical_because>` : ""}
<va_answer>${i.answer.slice(0, 500)}</va_answer>
</needs_work>`,
      );
    }
    const row = report.data as { strengths: unknown } | null;
    if (row && a.kind === "day") {
      for (const g of skillsOf({ strengths: list(row.strengths) })) for (const b of g.bullets) skills.push({ day: a.schedule_day, text: b, card: "" });
    }
    lines.push("</quiz>");
  }

  // Days the VA didn't take: in the training sequence but not in their schedule, or not finished.
  const seq = ((must(sequence)?.value as string[] | undefined) ?? []).filter((c) => /^W[12]D\d$/.test(c));
  const scheduled = new Set(r.path.path.map((d) => d.code));
  const notTaken = [
    ...seq.filter((c) => !scheduled.has(c)).map((code) => ({ code, title: titleOf.get(code) ?? "", reason: "not_scheduled" as const })),
    ...r.missing.map((d) => ({ code: d.code, title: d.title, reason: "not_finished" as const })),
  ];
  const notCovered = notCoveredText(vaFirst, notTaken);
  const header = `<va>${vaName}</va>
<office>${office?.name ?? ""}</office>
<days_done>${r.done} of ${r.total} scheduled quiz days</days_done>
${notCovered ? `<not_covered>${notCovered}</not_covered>\n` : ""}<cards>
${[...cards].map((c) => `- ${c}`).join("\n")}
</cards>
`;
  return {
    vaName,
    vaFirst,
    officeName: office?.name ?? "Office",
    doctor: doctors.primary ?? doctors.list[0]?.name ?? "Doctor",
    timeZone: zoneOf(office?.time_zone),
    items,
    cards: [...cards],
    skills,
    bankText: `${header}\n${lines.join("\n")}`,
    labels,
    notCovered,
  };
}

async function makeBank(ctx: Context, r: Readiness): Promise<Bank> {
  const base = { notCovered: ctx.notCovered, daysDone: r.done, daysTotal: r.total, overall: overallLabel(ctx.labels) };
  if (aiMode() !== "mock") {
    try {
      const checked = checkBank(await askTrainingBank(ctx.bankText), ctx.items, ctx.cards);
      if (checked.knows.length >= 3 && checked.practice.length >= 3) return { ...checked, ...base, source: "ai" };
      console.error("Training bank too short, using the fallback");
    } catch (e) {
      console.error("Training bank failed, using the fallback:", aiErrorMessage(e));
    }
  }
  return { ...fallbackBank(ctx.items, ctx.skills), ...base, source: "fallback" };
}

// The office's rules for the focus's workflows, for the sheet's scenarios.
async function rulesFor(db: Db, officeId: string, workflows: string[]) {
  const out: string[] = [];
  for (const w of workflows.slice(0, 3)) {
    for (const r of await officeRulesFor(db, officeId, w).catch(() => [])) out.push(`- ${r.key}: ${r.value.slice(0, 300)}`);
  }
  return [...new Set(out)].slice(0, 40);
}

async function makeSheet(db: Db, officeId: string, ctx: Context, s: PlannedSession): Promise<Sheet> {
  const steps = ctx.items.filter((i) => s.focus.refs.includes(i.ref)).flatMap((i) => (i.missed.length ? i.missed : i.correct));
  const fallback = fallbackSheet(s, ctx.vaFirst, [...new Set(steps)]);
  if (aiMode() === "mock") return fallback;
  const strengthWorkflows = ctx.items.filter((i) => i.full && i.day === s.strength.day && (!s.strength.card || i.card === s.strength.card)).map((i) => i.workflow);
  const rules = await rulesFor(db, officeId, [...s.focus.workflows, ...new Set(strengthWorkflows)]);
  const text = `<va_first_name>${ctx.vaFirst}</va_first_name>
<office>${ctx.officeName}</office>
<doctor>${ctx.doctor}</doctor>
<session>${s.number} of 8 (week ${s.week})</session>
<order>${scenarioOrder(s.number).join(", ")}</order>

<focus title="${s.focus.title}"${s.focus.safety ? ' safety="true"' : ""} cards="${s.focus.cards.join("; ")}" days="${s.focus.days.join(", ")}">
<what>${s.focus.text}</what>
<why>${s.focus.why}</why>
<steps>${[...new Set(steps)].slice(0, 8).join("; ")}</steps>
${s.focus.standards.length ? `<vfda_standards>${s.focus.standards.join("; ")}</vfda_standards>` : ""}
</focus>

<strength card="${s.strength.card}" day="${s.strength.day}">${s.strength.text}</strength>

<cards>
${ctx.cards.map((c) => `- ${c}`).join("\n")}
</cards>

<office_rules>
${rules.join("\n") || "(none recorded: use the card names and general front-desk practice)"}
</office_rules>`;
  try {
    return checkSheet(await askTrainingSheet(text), fallback, s.number);
  } catch (e) {
    console.error(`Training sheet ${s.number} failed, using the fallback:`, aiErrorMessage(e));
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const SHEET_CONCURRENCY = 4;

// Builds the bank, the plan and the 8 sheets into the program row (made
// first, so two runs at once don't both build). `test`: VFDA's button: the
// old program (if any) is replaced and missing days are allowed.
export async function buildProgram(
  db: Db,
  vaId: string,
  officeId: string,
  opts: { test?: boolean; by?: string | null; now?: Date } = {},
): Promise<{ status: "built" | "exists" | "not_ready"; programId?: string; missing: string[] }> {
  const r = await loadReadiness(db, vaId, officeId);
  const missing = r.missing.map((d) => d.code);
  if (!opts.test && !r.ready) return { status: "not_ready", missing };
  if (opts.test) must(await db.from("training_programs").delete().eq("va_id", vaId).eq("office_id", officeId).select("id"));
  const inserted = must(
    await db
      .from("training_programs")
      .upsert(
        { va_id: vaId, office_id: officeId, status: "building", trigger: opts.test ? "test" : "auto", missing_days: missing, created_by: opts.by ?? null },
        { onConflict: "va_id,office_id", ignoreDuplicates: true },
      )
      .select("id"),
  ) as { id: string }[] | null;
  if (!inserted?.length) return { status: "exists", missing };
  const programId = inserted[0].id;
  try {
    await fillProgram(db, programId, vaId, officeId, r, opts.now ?? new Date());
    return { status: "built", programId, missing };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("Training program not built", vaId, error);
    await db.from("training_programs").update({ status: "failed", error: error.slice(0, 500) }).eq("id", programId);
    throw e;
  }
}

async function fillProgram(db: Db, programId: string, vaId: string, officeId: string, r: Readiness, now: Date) {
  const ctx = await loadContext(db, vaId, officeId, r);
  const bank = await makeBank(ctx, r);
  const plan = planSessions(bank);
  if (!plan.length) throw new Error("Nothing to practice was found in the quiz results.");
  const sheets: Sheet[] = new Array(plan.length);
  const queue = plan.map((s, n) => ({ s, n }));
  await Promise.all(
    Array.from({ length: SHEET_CONCURRENCY }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const sheet = await makeSheet(db, officeId, ctx, job.s);
        // A focus area practiced a second time (fewer than 8 were found) says so.
        sheets[job.n] = job.s.recap && !/^review:/i.test(sheet.title) ? { ...sheet, title: `Review: ${sheet.title}` } : sheet;
      }
    }),
  );
  // Sunday nights in the office's time zone, starting the first Sunday after today.
  const start = sundayAfter(localParts(ctx.timeZone, now).date);
  must(
    await db
      .from("training_sessions")
      .insert(
        plan.map((s, n) => ({
          program_id: programId,
          va_id: vaId,
          office_id: officeId,
          number: s.number,
          week: s.week,
          send_on: addDays(start, (s.week - 1) * 7),
          focus: s.focus,
          strength: s.strength,
          sheet: sheets[n],
        })),
      )
      .select("id"),
  );
  must(
    await db
      .from("training_programs")
      .update({ status: "ready", bank, start_sunday: start, built_at: new Date().toISOString(), error: null })
      .eq("id", programId)
      .select("id"),
  );
}

// After every graded attempt, and from the Sunday cron (a retry for a build
// that failed or died): builds the program once all scheduled days are in.
export async function maybeBuildProgram(vaId: string, officeId: string) {
  const db = createAdminClient();
  const { program, missingTable } = await loadProgram(db, vaId, officeId);
  if (missingTable) return null;
  const stale = program && (program.status === "failed" || (program.status === "building" && Date.now() - Date.parse(program.created_at) > 15 * 60 * 1000));
  // A program VFDA generated for testing is replaced by the real one once every day is in.
  const testOnly = program?.trigger === "test" && program.status !== "building";
  if (program && !stale && !testOnly) return null;
  if (program && (stale || testOnly)) {
    if (!(await loadReadiness(db, vaId, officeId)).ready) return null;
    await db.from("training_programs").delete().eq("id", program.id);
  }
  return buildProgram(db, vaId, officeId);
}

// For a page: the program, or how far the VA is from it. Doctors never see
// a program VFDA generated for testing (`admin` false).
export async function loadProgramPage(db: Db, vaId: string, officeId: string, admin = true) {
  const [loaded, r] = await Promise.all([loadProgram(db, vaId, officeId), loadReadiness(db, vaId, officeId)]);
  const hide = !admin && loaded.program?.trigger === "test";
  const { missingTable } = loaded;
  const program = hide ? null : loaded.program;
  const sessions = hide ? [] : loaded.sessions;
  return { program, sessions, missingTable, readiness: { done: r.done, total: r.total, missing: r.missing.map((d) => `${d.code} ${d.title}`), ready: r.ready, triggerDay: r.triggerDay } };
}

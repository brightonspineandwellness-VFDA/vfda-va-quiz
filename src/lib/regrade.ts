import "server-only";

// "Re-grade with new rubric" (VFDA admin): grades a finished attempt's written
// answers again with the current rubric (src/lib/ai.ts GRADING_RUBRIC), works
// out its label and the VA's certifications again, then rebuilds the VA report
// (va_reports) and the doctor/VFDA PDF. Nothing is emailed or posted: the VA
// report keeps its emailed_at, and no notifications row is written.
//
// Safety checks are never relaxed: an item that had a critical error keeps it
// (with the VA's words), and a VFDA score override is left as it is.

import { CONFIDENCE_VALUE, gradeSituational, RUBRIC_VERSION, type Grade } from "@/lib/ai";
import { recalculateAttempt } from "@/lib/attempt-review";
import { recalculateCertifications } from "@/lib/certifications";
import { makeQuizReport } from "@/lib/quiz-reports";
import { loadAttemptReport } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { ANSWER_BOXES, formatOf, type AnswerFormat } from "@/lib/va-flow";
import { makeVaReport } from "@/lib/va-reports";
import { gradingSettings, officeRulesFor, type StoredFeedback } from "@/lib/va-training";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const CONCURRENCY = 4;

type Scenario = {
  id: string;
  type: "mc" | "situational" | "describe";
  answer_format: AnswerFormat | null;
  correct_response: unknown;
  critical_fail: string | null;
  escalation_level: string;
  workflow: string;
  stem: string;
  source_document_id: string | null;
};

export type RegradeResult = {
  attemptId: string;
  regraded: number; // answers graded again
  failed: number; // answers the grader couldn't score (kept as they were)
  before: { result: string | null; points: number; max: number };
  after: { result: string | null; points: number; max: number };
};

async function inBatches<T>(items: T[], n: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await run(x);
  }));
}

const stamp = (g: Grade): StoredFeedback & { reason: string } => ({
  reason: g.reason,
  did_well: g.did_well,
  missed_steps: g.score < 2 ? g.missed_steps : [],
  rubric: RUBRIC_VERSION,
});

export async function regradeAttempt(attemptId: string, db: Db = createAdminClient()): Promise<RegradeResult> {
  const attempt = must(
    await db
      .from("attempts")
      .select("id, va_id, office_id, schedule_day, submitted_at, result, first_try_points, max_points")
      .eq("id", attemptId)
      .maybeSingle(),
  );
  if (!attempt?.submitted_at) throw new Error("This attempt isn't finished yet.");
  const before = { result: attempt.result as string | null, points: Number(attempt.first_try_points ?? 0), max: attempt.max_points ?? 0 };

  const items =
    must(
      await db
        .from("attempt_items")
        .select("id, office_scenario_id, repeat_scenario_id, first_answer, repeat_answer, critical_error, critical_quote, vfda_override")
        .eq("attempt_id", attemptId),
    ) ?? [];
  const ids = [...new Set(items.flatMap((i) => [i.office_scenario_id, i.repeat_scenario_id]).filter((x): x is string => !!x))];
  const [scenarioRows, day, settings] = await Promise.all([
    db
      .from("office_scenarios")
      .select("id, type, answer_format, correct_response, critical_fail, escalation_level, workflow, stem, source_document_id")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    db.from("schedule_days").select("answer_format").eq("code", attempt.schedule_day).maybeSingle(),
    gradingSettings(db),
  ]);
  const scenarioOf = new Map(((must(scenarioRows) ?? []) as Scenario[]).map((s) => [s.id, s]));
  const dayFormat = ((must(day)?.answer_format as AnswerFormat | undefined) ?? "steps_say_doc") as AnswerFormat;
  const rulesCache = new Map<string, Promise<{ key: string; value: string }[]>>();
  const rulesFor = (s: Scenario) => {
    const k = `${s.workflow}:${s.source_document_id ?? ""}`;
    if (!rulesCache.has(k)) rulesCache.set(k, officeRulesFor(db, attempt.office_id, s.workflow, s.source_document_id));
    return rulesCache.get(k)!;
  };

  const grade = async (s: Scenario, answer: unknown) => {
    const a = (answer ?? {}) as Record<string, unknown>;
    const boxes = ANSWER_BOXES[formatOf(s.type, s.answer_format, dayFormat)].map((b) => ({ label: b.label, text: String(a[b.key] ?? "") }));
    if (!boxes.some((b) => b.text.trim())) return null;
    return gradeSituational({
      kind: s.type === "describe" ? "describe" : "situational",
      stem: s.stem,
      boxes,
      correctResponse: s.correct_response,
      criticalFail: s.critical_fail,
      escalationLevel: s.escalation_level,
      officeRules: await rulesFor(s),
      rules: settings.gradingRules,
      navigationRule: settings.navigationRule,
    });
  };

  let regraded = 0;
  let failed = 0;
  // Written answers only; multiple choice has one right answer. VFDA's overrides stay.
  const todo = items.filter((i) => {
    const s = scenarioOf.get(i.office_scenario_id);
    return s && s.type !== "mc" && i.first_answer && !i.vfda_override;
  });
  await inBatches(todo, CONCURRENCY, async (i) => {
    const s = scenarioOf.get(i.office_scenario_id)!;
    const repeatScenario = i.repeat_scenario_id ? scenarioOf.get(i.repeat_scenario_id) : undefined;
    const [first, repeat] = await Promise.all([
      grade(s, i.first_answer),
      repeatScenario && i.repeat_answer ? grade(repeatScenario, i.repeat_answer) : Promise.resolve(null),
    ]);
    if (!first) {
      failed++;
      return;
    }
    regraded++;
    // Never relaxed: a critical error found before stays, with the VA's words.
    const critical = i.critical_error || first.critical_error || !!repeat?.critical_error;
    const quote = i.critical_quote ?? (first.critical_error ? first.critical_quote : repeat?.critical_error ? repeat.critical_quote : null);
    const confidences = [first, repeat].filter((g): g is Grade => !!g).map((g) => CONFIDENCE_VALUE[g.confidence]);
    const update: Record<string, unknown> = {
      first_score: critical ? Math.min(first.score, 1) : first.score,
      first_feedback: stamp(first),
      critical_error: critical,
      critical_quote: critical ? quote : null,
      ai_confidence: Math.min(...confidences),
    };
    if (repeat) {
      update.repeat_score = repeat.critical_error ? Math.min(repeat.score, 1) : repeat.score;
      update.repeat_feedback = stamp(repeat);
    } else if (repeatScenario && i.repeat_answer) {
      failed++;
    }
    must(await db.from("attempt_items").update(update).eq("id", i.id).select("id"));
  });

  // The label (same score bands), the VA's certifications, then the reports. No sends.
  await recalculateAttempt(db as unknown as Parameters<typeof recalculateAttempt>[0], attemptId);
  await recalculateCertifications(attempt.va_id);
  await makeVaReport(db, attemptId, { replace: true });
  const loaded = await loadAttemptReport(db, attemptId);
  if (loaded) await makeQuizReport(db, attemptId, loaded.report);

  const now = must(await db.from("attempts").select("result, first_try_points, max_points").eq("id", attemptId).single())!;
  return {
    attemptId,
    regraded,
    failed,
    before,
    after: { result: now.result as string | null, points: Number(now.first_try_points ?? 0), max: now.max_points ?? 0 },
  };
}

// Whether every written answer of an attempt was graded with the current rubric.
async function onCurrentRubric(db: Db, attemptId: string) {
  const rows = must(await db.from("attempt_items").select("first_feedback, first_answer, vfda_override").eq("attempt_id", attemptId)) ?? [];
  return rows
    .filter((r) => r.first_answer && r.first_feedback && !r.vfda_override)
    .every((r) => (r.first_feedback as StoredFeedback).rubric === RUBRIC_VERSION);
}

// Every finished attempt of an office, oldest first, until `budgetMs` runs
// out (a server request can't run forever). Attempts already on the current
// rubric are skipped, so pressing the button again carries on.
export async function regradeOffice(officeId: string, budgetMs = 240_000) {
  const db = createAdminClient();
  const started = Date.now();
  const attempts =
    must(
      await db
        .from("attempts")
        .select("id")
        .eq("office_id", officeId)
        .not("submitted_at", "is", null)
        .not("result", "is", null)
        .is("archived_at", null)
        .order("submitted_at"),
    ) ?? [];
  let done = 0;
  let skipped = 0;
  const errors: string[] = [];
  const changed: RegradeResult[] = [];
  for (const a of attempts) {
    if (Date.now() - started > budgetMs) break;
    if (await onCurrentRubric(db, a.id)) {
      skipped++;
      continue;
    }
    try {
      changed.push(await regradeAttempt(a.id, db));
      done++;
    } catch (e) {
      errors.push(`${a.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const left = attempts.length - done - skipped - errors.length;
  return { total: attempts.length, done, skipped, left, errors, changed };
}

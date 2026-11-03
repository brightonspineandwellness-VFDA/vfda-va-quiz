import "server-only";

// The attempt review page (/admin/attempts/[id], and read-only for the
// office's doctor at /doctor/attempts/[id]): every item's first and repeat
// answer with scores and missed steps, and VFDA's score overrides, which
// change only the day's label. Reads with the signed-in user's session, so
// row-level security decides who sees what.

import type { createSessionClient } from "@/lib/supabase/server";
import {
  ANSWER_BOXES,
  certificationRules,
  dayResult,
  withOverride,
  type AnswerFormat,
  type DayRow,
  type ScoreOverride,
} from "@/lib/va-flow";

type Db = Awaited<ReturnType<typeof createSessionClient>>;

const DAY_COLUMNS =
  "code, week, day, title, cards, condition, max_points, pass_points, review_min_points, answer_format, proof_of_work";

type Scenario = {
  id: string;
  code: string;
  type: "mc" | "situational";
  points: number;
  workflow: string;
  part_title: string;
  stem: string;
  answer_format: AnswerFormat | null;
};

export type ReviewAnswer = {
  scenario: Scenario | null;
  // Box label and text, or the picked option for multiple choice.
  parts: { label: string; text: string }[];
  score: number | null;
  reason: string;
  missedSteps: string[];
};

export type ReviewItem = {
  id: string;
  code: string;
  workflow: string;
  type: "mc" | "situational";
  points: number;
  first: ReviewAnswer;
  repeat: ReviewAnswer | null;
  criticalError: boolean;
  criticalQuote: string | null;
  confidence: number | null;
  needsReview: boolean;
  seconds: number | null;
  fast: boolean;
  pastes: number;
  override: ScoreOverride | null;
};

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

type Feedback = { reason?: string; missed_steps?: string[]; ungraded?: boolean } | null;

function answerParts(answer: unknown, scenario: Scenario | null, dayFormat: AnswerFormat): ReviewAnswer["parts"] {
  if (!answer || typeof answer !== "object") return [];
  const a = answer as Record<string, unknown>;
  if (scenario?.type === "mc") return [{ label: `Picked ${String(a.choice ?? "?")}`, text: String(a.text ?? "") }];
  const boxes = ANSWER_BOXES[scenario?.answer_format ?? dayFormat];
  return boxes.map((b) => ({ label: b.label, text: String(a[b.key] ?? "") }));
}

export async function loadAttemptReview(db: Db, attemptId: string) {
  const attempt = must(
    await db
      .from("attempts")
      .select(
        "id, va_id, office_id, schedule_day, version, kind, started_at, submitted_at, first_try_points, max_points, result, critical_errors, time_spent, paste_log, fast_finish, feedback_released_at",
      )
      .eq("id", attemptId)
      .maybeSingle(),
  );
  if (!attempt) return null;

  const [va, office, day, rows, notes] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", attempt.va_id).maybeSingle(),
    db.from("offices").select("name").eq("id", attempt.office_id).maybeSingle(),
    db.from("schedule_days").select(DAY_COLUMNS).eq("code", attempt.schedule_day).maybeSingle(),
    db
      .from("attempt_items")
      .select(
        "id, office_scenario_id, position, first_answer, first_score, first_feedback, repeat_scenario_id, repeat_answer, repeat_score, repeat_feedback, critical_error, critical_quote, ai_confidence, time_per_item, fast, paste_log, vfda_override",
      )
      .eq("attempt_id", attemptId)
      .order("position"),
    db.from("notifications").select("channel, recipient, status, sent_at, error, event").eq("attempt_id", attemptId).order("created_at"),
  ]);
  const items = must(rows) ?? [];
  const ids = [...new Set(items.flatMap((i) => [i.office_scenario_id, i.repeat_scenario_id]).filter(Boolean))] as string[];
  const scenarios = ids.length
    ? ((must(
        await db
          .from("office_scenarios")
          .select("id, code, type, points, workflow, part_title, stem, answer_format")
          .in("id", ids),
      ) ?? []) as Scenario[])
    : [];
  const scenarioOf = new Map(scenarios.map((s) => [s.id, s]));
  const dayRow = must(day) as DayRow | null;
  const dayFormat: AnswerFormat = dayRow?.answer_format ?? "steps_say_doc";

  const reviewItems: ReviewItem[] = items.map((i) => {
    const parent = scenarioOf.get(i.office_scenario_id) ?? null;
    const repeatScenario = i.repeat_scenario_id ? (scenarioOf.get(i.repeat_scenario_id) ?? null) : null;
    const first = i.first_feedback as Feedback;
    const again = i.repeat_feedback as Feedback;
    return {
      id: i.id,
      code: parent?.code ?? "?",
      workflow: parent?.workflow ?? "",
      type: parent?.type ?? "situational",
      points: parent?.points ?? 2,
      first: {
        scenario: parent,
        parts: answerParts(i.first_answer, parent, dayFormat),
        score: i.first_score,
        reason: first?.reason ?? "",
        missedSteps: (first?.missed_steps ?? []).map(String),
      },
      repeat: i.repeat_scenario_id
        ? {
            scenario: repeatScenario,
            parts: answerParts(i.repeat_answer, repeatScenario, dayFormat),
            score: i.repeat_score,
            reason: again?.reason ?? "",
            missedSteps: (again?.missed_steps ?? []).map(String),
          }
        : null,
      criticalError: i.critical_error,
      criticalQuote: i.critical_quote,
      confidence: i.ai_confidence === null ? null : Number(i.ai_confidence),
      needsReview: parent?.type === "situational" && !!i.first_answer && (i.first_score === null || !!first?.ungraded),
      seconds: i.time_per_item,
      fast: i.fast,
      pastes: Array.isArray(i.paste_log) ? i.paste_log.length : 0,
      override: (i.vfda_override as ScoreOverride | null) ?? null,
    };
  });

  return {
    attempt,
    vaName: (must(va)?.full_name || must(va)?.email || "VA") as string,
    officeName: (must(office)?.name ?? "Office") as string,
    day: dayRow,
    items: reviewItems,
    notifications: (must(notes) ?? []) as {
      channel: string;
      recipient: string;
      status: "pending" | "sent" | "failed";
      sent_at: string | null;
      error: string | null;
      event: string;
    }[],
  };
}

export type AttemptReviewData = NonNullable<Awaited<ReturnType<typeof loadAttemptReview>>>;

// Works the label out again with VFDA's overrides. Nothing else changes:
// quizzes never block.
export async function recalculateAttempt(db: Db, attemptId: string) {
  const [settings, rows] = await Promise.all([
    db.from("settings").select("value").eq("key", "grading").maybeSingle(),
    db
      .from("attempt_items")
      .select("office_scenario_id, first_score, repeat_score, critical_error, ai_confidence, vfda_override")
      .eq("attempt_id", attemptId),
  ]);
  const items = must(rows) ?? [];
  const scenarios =
    must(
      await db
        .from("office_scenarios")
        .select("id, type, points")
        .in(
          "id",
          items.map((i) => i.office_scenario_id),
        ),
    ) ?? [];
  const scenarioOf = new Map(scenarios.map((s) => [s.id, s]));
  const outcome = dayResult(
    items
      .filter((i) => scenarioOf.has(i.office_scenario_id))
      .map((i) => ({
        type: scenarioOf.get(i.office_scenario_id)!.type,
        points: scenarioOf.get(i.office_scenario_id)!.points,
        ...withOverride(
          {
            first_score: i.first_score,
            repeat_score: i.repeat_score,
            critical_error: i.critical_error,
            ai_confidence: i.ai_confidence === null ? null : Number(i.ai_confidence),
          },
          i.vfda_override,
        ),
      })),
    certificationRules(must(settings)?.value),
  );
  const { error } = await db
    .from("attempts")
    .update({
      first_try_points: outcome.points,
      max_points: outcome.max,
      result: outcome.result,
      critical_errors: outcome.criticalErrors,
    })
    .eq("id", attemptId);
  if (error) throw new Error(error.message);
  return outcome;
}

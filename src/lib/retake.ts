// A day's retake next to its first try, question by question: the first-try
// score (official) and the retake score of each question, with the ones
// missed the first time marked. Used by the reports, the progress pages and
// the attempt review. The pure half has no server-only imports, so tests can
// load it; the loader reads with whichever client it's given (row-level
// security applies to a session client).

import type { SupabaseClient } from "@supabase/supabase-js";
import { percentOf, withOverride, type ResultLabel } from "@/lib/va-flow";

export type RetakeLine = {
  code: string;
  workflow: string;
  points: number;
  first: number | null;
  retake: number | null;
  // Below full points (or not graded) on the first try.
  missedFirst: boolean;
};

export type RetakeComparison = {
  firstAttemptId: string;
  retakeAttemptId: string;
  first: { points: number; max: number; percent: number; result: ResultLabel | null };
  retake: { points: number; max: number; percent: number; result: ResultLabel | null; submitted: boolean };
  lines: RetakeLine[];
  missedFirst: number;
  // Of the questions missed the first time, how many got full points on the retake.
  fixed: number;
};

type AttemptRow = { id: string; first_try_points: number | string | null; max_points: number | null; result: string | null; submitted_at: string | null };
type ItemRow = { attempt_id: string; office_scenario_id: string; position: number; first_score: number | null; vfda_override: unknown };
type ScenarioRow = { id: string; code: string; workflow: string; points: number; parent_scenario_id: string | null };

const score = (i: ItemRow) => withOverride({ first_score: i.first_score, repeat_score: null, critical_error: false, ai_confidence: null }, i.vfda_override).first_score;
const asResult = (r: string | null) => (r === "strong" || r === "needs_coaching" || r === "at_risk" ? r : null);

// Retake items are new versions of the first try's items (parent_scenario_id).
export function compareRetake(first: AttemptRow, retake: AttemptRow, items: ItemRow[], scenarios: ScenarioRow[]): RetakeComparison {
  const scenarioOf = new Map(scenarios.map((s) => [s.id, s]));
  const retakeByOriginal = new Map(
    items
      .filter((i) => i.attempt_id === retake.id)
      .map((i) => [scenarioOf.get(i.office_scenario_id)?.parent_scenario_id ?? "", i] as const),
  );
  const lines = items
    .filter((i) => i.attempt_id === first.id)
    .sort((a, b) => a.position - b.position)
    .map((i): RetakeLine => {
      const s = scenarioOf.get(i.office_scenario_id);
      const points = s?.points ?? 2;
      const firstScore = score(i);
      const again = retakeByOriginal.get(i.office_scenario_id);
      return {
        code: s?.code ?? "?",
        workflow: s?.workflow ?? "",
        points,
        first: firstScore,
        retake: again ? score(again) : null,
        missedFirst: firstScore === null || firstScore < points,
      };
    });
  const total = (a: AttemptRow) => Number(a.first_try_points ?? 0);
  return {
    firstAttemptId: first.id,
    retakeAttemptId: retake.id,
    first: { points: total(first), max: first.max_points ?? 0, percent: percentOf(first.first_try_points, first.max_points), result: asResult(first.result) },
    retake: {
      points: total(retake),
      max: retake.max_points ?? 0,
      percent: percentOf(retake.first_try_points, retake.max_points),
      result: asResult(retake.result),
      submitted: !!retake.submitted_at,
    },
    lines,
    missedFirst: lines.filter((l) => l.missedFirst).length,
    fixed: lines.filter((l) => l.missedFirst && l.retake !== null && l.retake >= l.points).length,
  };
}

const ATTEMPT_COLUMNS = "id, kind, parent_attempt_id, first_try_points, max_points, result, submitted_at";

// The comparison for an attempt that is a retake, or a day attempt that has
// one (not archived). Null otherwise.
export async function loadRetakeComparison(db: SupabaseClient, attemptId: string): Promise<RetakeComparison | null> {
  const { data: attempt } = await db.from("attempts").select(ATTEMPT_COLUMNS).eq("id", attemptId).maybeSingle();
  if (!attempt) return null;
  let first: AttemptRow | null = null;
  let retake: AttemptRow | null = null;
  if (attempt.kind === "retake" && attempt.parent_attempt_id) {
    retake = attempt;
    first = (await db.from("attempts").select(ATTEMPT_COLUMNS).eq("id", attempt.parent_attempt_id).maybeSingle()).data;
  } else if (attempt.kind === "day") {
    first = attempt;
    retake = (
      await db.from("attempts").select(ATTEMPT_COLUMNS).eq("parent_attempt_id", attempt.id).eq("kind", "retake").is("archived_at", null).maybeSingle()
    ).data;
  }
  if (!first || !retake) return null;
  const { data: items } = await db
    .from("attempt_items")
    .select("attempt_id, office_scenario_id, position, first_score, vfda_override")
    .in("attempt_id", [first.id, retake.id]);
  const ids = [...new Set((items ?? []).map((i) => i.office_scenario_id as string))];
  const { data: scenarios } = ids.length
    ? await db.from("office_scenarios").select("id, code, workflow, points, parent_scenario_id").in("id", ids)
    : { data: [] };
  return compareRetake(first, retake, (items ?? []) as ItemRow[], (scenarios ?? []) as ScenarioRow[]);
}

// One line per question, as the reports write it.
export const retakeLineText = (l: RetakeLine) =>
  `${l.code} (${l.workflow}): first try ${l.first === null ? "ungraded" : `${l.first}/${l.points}`}, retake ${
    l.retake === null ? "–" : `${l.retake}/${l.points}`
  }${l.missedFirst ? " (below full points first time)" : ""}`;

import "server-only";

// Loads what VFDA's scenario review pages show. Read as the signed-in admin
// (row-level security applies), except the office's day plan.

import type { CorrectResponse, DayKind } from "@/lib/scenario-build";
import { loadOfficeBuild } from "@/lib/scenario-builder";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

export type OfficeDayRow = {
  schedule_day: string;
  build_status: "none" | "running" | "done" | "failed";
  build_error: string | null;
  built_at: string | null;
  approved_at: string | null;
};

export type ScenarioRow = {
  id: string;
  scenario_id: string | null;
  version: "A" | "B";
  workflow: string;
  part: string;
  part_title: string;
  code: string;
  type: "mc" | "situational";
  points: number;
  answer_format: string | null;
  stem: string;
  options: string[] | null;
  answer: string | null;
  correct_response: CorrectResponse | null;
  critical_fail: string | null;
  escalation_level: string;
  is_repeat_variant: boolean;
  parent_scenario_id: string | null;
  test_status: string;
  edited_by_vfda: boolean;
  missing_keys: string[];
  formula: string | null;
  position: number;
};

const SCENARIO_COLUMNS =
  "id, scenario_id, version, workflow, part, part_title, code, type, points, answer_format, stem, options, answer, correct_response, critical_fail, escalation_level, is_repeat_variant, parent_scenario_id, test_status, edited_by_vfda, missing_keys, formula, position";

export type DaySummary = {
  code: string;
  title: string;
  kind: DayKind;
  status: OfficeDayRow | null;
  countA: number;
  countB: number;
  repeats: number;
  missing: number;
  started: boolean;
};

export async function loadScenarioOverview(officeId: string) {
  const ctx = await loadOfficeBuild(createAdminClient(), officeId);
  if (!ctx) return null;
  const supabase = await createSessionClient();
  const [days, scenarios, attempts] = await Promise.all([
    supabase
      .from("office_days")
      .select("schedule_day, build_status, build_error, built_at, approved_at")
      .eq("office_id", officeId),
    supabase
      .from("office_scenarios")
      .select("schedule_day, version, is_repeat_variant, missing_keys")
      .eq("office_id", officeId),
    supabase.from("attempts").select("schedule_day").eq("office_id", officeId),
  ]);
  const rows = scenarios.data ?? [];
  const started = new Set((attempts.data ?? []).map((a) => a.schedule_day));
  const summaries: DaySummary[] = ctx.days.map(({ day, kind }) => {
    const mine = rows.filter((r) => r.schedule_day === day.code);
    return {
      code: day.code,
      title: day.title,
      kind,
      status: ((days.data ?? []) as OfficeDayRow[]).find((d) => d.schedule_day === day.code) ?? null,
      countA: mine.filter((r) => r.version === "A" && !r.is_repeat_variant).length,
      countB: mine.filter((r) => r.version === "B" && !r.is_repeat_variant).length,
      repeats: mine.filter((r) => r.is_repeat_variant).length,
      missing: mine.filter((r) => r.missing_keys.length > 0).length,
      started: started.has(day.code),
    };
  });
  return { office: ctx.office as { id: string; name: string; status: string }, days: summaries };
}

export async function loadScenarioDay(officeId: string, day: string) {
  const overview = await loadScenarioOverview(officeId);
  const summary = overview?.days.find((d) => d.code === day);
  if (!overview || !summary) return null;
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("office_scenarios")
    .select(SCENARIO_COLUMNS)
    .eq("office_id", officeId)
    .eq("schedule_day", day)
    .order("position")
    .order("code");
  const rows = (data ?? []) as ScenarioRow[];
  const masterIds = [...new Set(rows.map((r) => r.scenario_id).filter((x): x is string => !!x))];
  const { data: masters } = masterIds.length
    ? await supabase.from("scenarios").select("id, stem, options, options_rule, answer, correct_response, critical_fail").in("id", masterIds)
    : { data: [] };
  return {
    office: overview.office,
    summary,
    rows,
    masters: new Map((masters ?? []).map((m) => [m.id as string, m])),
  };
}

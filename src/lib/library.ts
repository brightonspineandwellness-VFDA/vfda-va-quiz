import "server-only";

import { createSessionClient } from "@/lib/supabase/server";

// The standard workflow library (Layer 1) as stored by `npm run import:bank`.
// Read with the signed-in user's session: master scenarios hold answer keys,
// so row-level security limits them to VFDA admins.

export type SayDoBook = { Say: string[]; Do: string[]; Book: string[] };

export type Workflow = {
  id: string;
  code: string;
  name: string;
  trigger: string;
  required_information: string[];
  steps: string[];
  definition_of_done: string;
  va_can_decide: string[];
  requires_approval: string[];
  immediate_escalation: string[];
  common_mistakes: string[];
  prohibited_actions: string[];
  pass_standard: string;
  sop_outline: string[];
  bank_refs: string[];
  rule_keys: string[];
  test_scenarios: string[];
};

export type ScheduleDay = {
  code: string;
  week: number;
  day: number;
  title: string;
  condition: string;
  max_points: number | null;
  pass_points: number | null;
  review_min_points: number | null;
  answer_format: string;
};

export type Scenario = {
  id: string;
  schedule_day: string;
  code: string;
  version: string;
  workflow: string;
  part: string;
  part_title: string;
  condition: string;
  type: "mc" | "situational";
  stem: string;
  options: string[] | null;
  options_rule: string | null;
  answer: string | null;
  correct_response: string[] | SayDoBook | null;
  critical_fail: string | null;
  escalation_level: "none" | "approval" | "immediate";
  bank_ref: string;
  points: number;
  answer_format: string | null;
  repeat_variant: string | null;
  test_status: string;
};

export type DayCount = { code: string; title: string; count: number };

export type WorkflowSummary = Workflow & { scenarioCount: number; byDay: DayCount[] };

const DAY_COLUMNS = "code, week, day, title, condition, max_points, pass_points, review_min_points, answer_format";

export async function getLibraryOverview() {
  const supabase = await createSessionClient();
  const [workflows, scenarios, days, info] = await Promise.all([
    supabase.from("workflows").select("*").order("position"),
    supabase.from("scenarios").select("workflow, schedule_day"),
    supabase.from("schedule_days").select(DAY_COLUMNS).order("week").order("day"),
    supabase.from("settings").select("value").eq("key", "bank_info").maybeSingle(),
  ]);
  for (const r of [workflows, scenarios, days]) if (r.error) throw r.error;

  const allDays = (days.data ?? []) as ScheduleDay[];
  const rows = (scenarios.data ?? []) as Pick<Scenario, "workflow" | "schedule_day">[];
  const summaries: WorkflowSummary[] = ((workflows.data ?? []) as Workflow[]).map((wf) => {
    const mine = rows.filter((s) => s.workflow === wf.code);
    return {
      ...wf,
      scenarioCount: mine.length,
      byDay: allDays
        .map((d) => ({ code: d.code, title: d.title, count: mine.filter((s) => s.schedule_day === d.code).length }))
        .filter((d) => d.count > 0),
    };
  });

  const bankInfo = (info.data?.value ?? null) as { version?: string; date?: string } | null;
  return { workflows: summaries, scenarioCount: rows.length, bankInfo };
}

export async function getWorkflowWithScenarios(code: string) {
  const supabase = await createSessionClient();
  const { data: workflow, error } = await supabase.from("workflows").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  if (!workflow) return null;

  const [scenarios, days, slots] = await Promise.all([
    supabase.from("scenarios").select("*").eq("workflow", code).order("position"),
    supabase.from("schedule_days").select(DAY_COLUMNS).order("week").order("day"),
    supabase.from("rule_slots").select("key, question").in("key", (workflow as Workflow).rule_keys),
  ]);
  for (const r of [scenarios, days, slots]) if (r.error) throw r.error;

  const allScenarios = (scenarios.data ?? []) as Scenario[];
  const byDay = ((days.data ?? []) as ScheduleDay[])
    .map((day) => ({ day, scenarios: allScenarios.filter((s) => s.schedule_day === day.code) }))
    .filter((g) => g.scenarios.length > 0);

  return {
    workflow: workflow as Workflow,
    byDay,
    scenarioCount: allScenarios.length,
    ruleQuestions: Object.fromEntries((slots.data ?? []).map((s) => [s.key, s.question])) as Record<string, string>,
  };
}

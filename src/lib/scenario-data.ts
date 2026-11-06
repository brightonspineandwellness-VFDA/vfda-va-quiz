import "server-only";

// Loads what VFDA's scenario review pages show: each day's latest build
// version, its live version and which VAs took which version. Read as the
// signed-in admin (row-level security applies), except the office's day plan.

import type { CorrectResponse, DayKind } from "@/lib/scenario-build";
import { loadOfficeBuild } from "@/lib/scenario-builder";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

export type OfficeDayRow = {
  schedule_day: string;
  build_status: "none" | "running" | "done" | "failed";
  build_error: string | null;
  built_at: string | null;
  approved_at: string | null;
  // The latest version built (reviewed here) and the one new attempts get.
  build_version: number | null;
  live_version: number | null;
  // Extra cards left out of the gray card day (more than its item count).
  left_out?: { code: string; name: string; reason: string }[];
};

// A missing {KEY} and the rule that answers it (the key's own slot, or the
// rule a derived placeholder comes from).
export type MissingRule = { key: string; slot: string | null; question: string; answerType: string | null; items: string[] };

// A VA's (not archived) attempt at a day, on the version they started.
export type TakenBy = { name: string; version: number };

export type ScenarioRow = {
  id: string;
  scenario_id: string | null;
  version: string;
  build_version: number;
  workflow: string;
  part: string;
  part_title: string;
  code: string;
  type: "mc" | "situational" | "describe";
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
  source_card: string | null;
  source_quote: string | null;
  review_error: string | null;
};

const SCENARIO_COLUMNS =
  "id, scenario_id, version, build_version, workflow, part, part_title, code, type, points, answer_format, stem, options, answer, correct_response, critical_fail, escalation_level, is_repeat_variant, parent_scenario_id, test_status, edited_by_vfda, missing_keys, formula, position, source_card, source_quote, review_error";

export type DaySummary = {
  code: string;
  title: string;
  kind: DayKind;
  status: OfficeDayRow | null;
  countA: number;
  repeats: number;
  missing: number;
  // Items that still failed a check after the rewrites.
  needsReview: number;
  // The latest version is the live one.
  approved: boolean;
  takenBy: TakenBy[];
  // A VA (archived attempts too) took the live version: it can't be reopened.
  liveTaken: boolean;
  // Card PDFs mapped to the day (the day is written from these).
  cards: string[];
};

export async function loadScenarioOverview(officeId: string) {
  const ctx = await loadOfficeBuild(createAdminClient(), officeId);
  if (!ctx) return null;
  const supabase = await createSessionClient();
  const [days, scenarios, attempts, documents] = await Promise.all([
    supabase
      .from("office_days")
      .select("schedule_day, build_status, build_error, built_at, approved_at, build_version, live_version, left_out")
      .eq("office_id", officeId),
    supabase
      .from("office_scenarios")
      .select("schedule_day, version, build_version, is_repeat_variant, missing_keys, test_status")
      .eq("office_id", officeId),
    supabase
      .from("attempts")
      .select("va_id, schedule_day, build_version, archived_at")
      .eq("office_id", officeId)
      .eq("kind", "day")
      .order("started_at"),
    supabase
      .from("office_documents")
      .select("card_title, file_name, schedule_days")
      .eq("office_id", officeId)
      .eq("kind", "card")
      .eq("skip", false)
      .not("imported_at", "is", null),
  ]);
  const rows = scenarios.data ?? [];
  const attemptRows = attempts.data ?? [];
  const vaIds = [...new Set(attemptRows.map((a) => a.va_id))];
  const { data: people } = vaIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", vaIds)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, (p.full_name as string) || (p.email as string)]));
  const summaries: DaySummary[] = ctx.days.map(({ day, kind }) => {
    const status = ((days.data ?? []) as OfficeDayRow[]).find((d) => d.schedule_day === day.code) ?? null;
    // Only the latest version (older ones stay for the VAs who took them).
    const mine = rows.filter((r) => r.schedule_day === day.code && r.build_version === (status?.build_version ?? 1));
    const taken = attemptRows.filter((a) => a.schedule_day === day.code);
    return {
      code: day.code,
      title: day.title,
      kind,
      status,
      countA: mine.filter((r) => r.version === "A" && !r.is_repeat_variant).length,
      repeats: mine.filter((r) => r.version === "A" && r.is_repeat_variant).length,
      missing: mine.filter((r) => r.missing_keys.length > 0).length,
      needsReview: mine.filter((r) => r.version === "A" && r.test_status === "needs_review").length,
      approved: !!status?.live_version && status.live_version === status.build_version,
      takenBy: taken
        .filter((a) => !a.archived_at)
        .map((a) => ({ name: nameOf.get(a.va_id) ?? "A VA", version: (a.build_version as number | null) ?? 1 })),
      liveTaken: !!status?.live_version && taken.some((a) => a.build_version === status.live_version),
      cards: (documents.data ?? [])
        .filter((d) => (d.schedule_days ?? []).includes(day.code))
        .map((d) => d.card_title || d.file_name),
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
    .eq("build_version", summary.status?.build_version ?? 1)
    .order("position")
    .order("code");
  const rows = (data ?? []) as ScenarioRow[];
  const masterIds = [...new Set(rows.map((r) => r.scenario_id).filter((x): x is string => !!x))];
  const missing = await missingRules(rows.filter((r) => !r.is_repeat_variant && r.version === "A"));
  const { data: masters } = masterIds.length
    ? await supabase.from("scenarios").select("id, stem, options, options_rule, answer, correct_response, critical_fail").in("id", masterIds)
    : { data: [] };
  return {
    office: overview.office,
    summary,
    rows,
    masters: new Map((masters ?? []).map((m) => [m.id as string, m])),
    missing,
  };
}

// Every key the day's scenarios still miss, in order, with the items using it.
async function missingRules(rows: ScenarioRow[]): Promise<MissingRule[]> {
  const keys = [...new Set(rows.flatMap((r) => r.missing_keys))].sort();
  if (!keys.length) return [];
  const db = createAdminClient();
  const { data: setting } = await db.from("settings").select("value").eq("key", "derived_placeholders").maybeSingle();
  const derived = new Map(((setting?.value ?? []) as { key: string; from_key: string }[]).map((d) => [d.key, d.from_key]));
  const slotKeys = [...new Set(keys.flatMap((k) => [k, derived.get(k)].filter((x): x is string => !!x)))];
  const { data: slots } = await db.from("rule_slots").select("key, question, answer_type").in("key", slotKeys);
  const slotOf = new Map((slots ?? []).map((s) => [s.key as string, s as { key: string; question: string; answer_type: string }]));
  return keys.map((key) => {
    const slot = slotOf.get(key) ?? slotOf.get(derived.get(key) ?? "") ?? null;
    return {
      key,
      slot: slot?.key ?? null,
      question: slot ? (slot.key === key ? slot.question : `${slot.question} (${key} is picked from ${slot.key})`) : "",
      answerType: slot?.answer_type ?? null,
      items: rows.filter((r) => r.missing_keys.includes(key)).map((r) => r.code),
    };
  });
}

// "Melle VA already took version 1; this rebuild will be version 2 for new
// attempts." Null when no VA has taken the day.
export function rebuildNote(d: Pick<DaySummary, "takenBy" | "status">): string | null {
  if (!d.takenBy.length) return null;
  const byVersion = new Map<number, string[]>();
  for (const t of d.takenBy) byVersion.set(t.version, [...(byVersion.get(t.version) ?? []), t.name]);
  const names = (list: string[]) =>
    list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  const took = [...byVersion]
    .sort(([a], [b]) => a - b)
    .map(([v, list]) => `${names([...new Set(list)])} already took version ${v}`)
    .join("; ");
  return `${took}; this rebuild will be version ${(d.status?.build_version ?? 0) + 1} for new attempts.`;
}

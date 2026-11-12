import "server-only";

// Loads and records where each graded item's rule came from (src/lib/rule-source.ts).
// Written when an item is graded (attempt_items.rule_source, see
// supabase/rule-sources.sql); the reports read it, and work it out the same
// way for items graded before it was recorded (or before the column exists).

import { LOCKED_STANDARDS } from "@/lib/card-map";
import { describeRuleSource, parseRuleSource, type ItemRuleSource } from "@/lib/rule-source";
import { placeholdersIn, ruleText, type DerivedPlaceholder } from "@/lib/scenario-build";
import { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient>;

type RuleRow = {
  rule_slot_key: string;
  rule: unknown;
  source_document_id: string | null;
  source: string;
};

// The grader's order when an office has more than one accepted rule for a
// slot (src/lib/va-training.ts officeRulesFor): VFDA's safety standards
// first, then what the doctor or VFDA typed in, the doctor's own card, the
// item's card, other cards, and the VFDA default last.
export function graderRank(r: RuleRow, sourceDocumentId: string | null) {
  return LOCKED_STANDARDS.includes(r.rule_slot_key) && r.source === "vfda_default"
    ? -1
    : r.source === "doctor" || r.source === "vfda"
      ? 0
      : r.source === "doctor_card"
        ? 1
        : r.source === "card_import"
          ? r.source_document_id === sourceDocumentId
            ? 2
            : 3
          : 4;
}

type ScenarioRow = {
  id: string;
  scenario_id: string | null;
  parent_scenario_id: string | null;
  workflow: string;
  part_title: string | null;
  source_card: string | null;
  source_quote: string | null;
  source_document_id: string | null;
};

const NONE = "00000000-0000-0000-0000-000000000000";
const ids = (a: (string | null | undefined)[]) => {
  const out = [...new Set(a.filter((x): x is string => !!x))];
  return out.length ? out : [NONE];
};

// The sources of these office scenarios (an item's first scenario), keyed by id.
export async function ruleSourcesFor(db: Db, officeId: string, scenarioIds: string[]): Promise<Map<string, ItemRuleSource>> {
  const out = new Map<string, ItemRuleSource>();
  if (!scenarioIds.length) return out;
  const cols = "id, scenario_id, parent_scenario_id, workflow, part_title, source_card, source_quote, source_document_id";
  const { data: rows, error } = await db.from("office_scenarios").select(cols).in("id", ids(scenarioIds));
  if (error || !rows?.length) return out;
  const scenarios = rows as ScenarioRow[];
  // A repeat or retake version: its master is its parent's.
  const parentIds = scenarios.filter((s) => !s.scenario_id && s.parent_scenario_id).map((s) => s.parent_scenario_id);
  const parents = parentIds.length
    ? (((await db.from("office_scenarios").select("id, scenario_id").in("id", ids(parentIds))).data ?? []) as { id: string; scenario_id: string | null }[])
    : [];
  const masterOf = (s: ScenarioRow) => s.scenario_id ?? parents.find((p) => p.id === s.parent_scenario_id)?.scenario_id ?? null;

  const [masters, derivedSetting, workflows, gray] = await Promise.all([
    db
      .from("scenarios")
      .select("id, stem, options, answer, correct_response, critical_fail")
      .in("id", ids(scenarios.map(masterOf))),
    db.from("settings").select("value").eq("key", "derived_placeholders").maybeSingle(),
    db.from("workflows").select("code, name"),
    db.from("office_workflows").select("code, name").eq("office_id", officeId),
  ]);
  const derived = ((derivedSetting.data?.value as DerivedPlaceholder[] | null) ?? []).filter((d) => d?.key && d?.from_key);
  const fromKey = new Map(derived.map((d) => [d.key, d.from_key]));
  const keysOf = new Map(
    ((masters.data ?? []) as Record<string, unknown>[]).map((m) => [
      String(m.id),
      [...new Set(placeholdersIn([m.stem, m.options, m.answer, m.correct_response, m.critical_fail]).map((k) => fromKey.get(k) ?? k))],
    ]),
  );
  const names = new Map<string, string>([...(workflows.data ?? []), ...(gray.data ?? [])].map((w) => [String(w.code), String(w.name ?? w.code)]));

  const allKeys = [...new Set([...keysOf.values()].flat())];
  const rules = allKeys.length
    ? (((
        await db
          .from("office_rules")
          .select("rule_slot_key, rule, source_document_id, source")
          .eq("office_id", officeId)
          .eq("status", "accepted")
          .in("rule_slot_key", allKeys)
      ).data ?? []) as RuleRow[])
    : [];

  for (const s of scenarios) {
    const keys = keysOf.get(masterOf(s) ?? "") ?? [];
    const used: { key: string; value: string; source: string }[] = [];
    for (const key of keys) {
      const candidates = rules
        .filter((r) => r.rule_slot_key === key)
        .filter((r) => r.source !== "card_import" || !s.source_document_id || r.source_document_id === s.source_document_id);
      const best = [...candidates].sort((a, b) => graderRank(a, s.source_document_id) - graderRank(b, s.source_document_id))[0];
      if (best) used.push({ key, value: ruleText(best.rule), source: best.source });
    }
    out.set(
      s.id,
      describeRuleSource({
        sourceCard: s.source_card,
        sourceQuote: s.source_quote,
        topic: s.part_title?.trim() || names.get(s.workflow) || s.workflow,
        rules: used,
      }),
    );
  }
  return out;
}

// Recorded when an item is graded. Never stops the grade: before
// supabase/rule-sources.sql is run the column isn't there, and the reports
// work the source out instead.
export async function recordRuleSource(db: Db, officeId: string, itemId: string, scenarioId: string) {
  try {
    const source = (await ruleSourcesFor(db, officeId, [scenarioId])).get(scenarioId);
    if (source) await db.from("attempt_items").update({ rule_source: source }).eq("id", itemId);
  } catch (e) {
    console.error("Rule source not recorded", itemId, e instanceof Error ? e.message : e);
  }
}

// Each item's source for a report, keyed by the item's first scenario: the
// recorded one, else worked out now.
export async function itemRuleSources(db: Db, attemptId: string, officeId: string, scenarioIds: string[]): Promise<Map<string, ItemRuleSource>> {
  const out = new Map<string, ItemRuleSource>();
  const { data, error } = await db.from("attempt_items").select("office_scenario_id, rule_source").eq("attempt_id", attemptId);
  if (!error) {
    for (const r of (data ?? []) as {
      office_scenario_id: string;
      rule_source: unknown;
    }[]) {
      const s = parseRuleSource(r.rule_source);
      if (s) out.set(r.office_scenario_id, s);
    }
  }
  const missing = scenarioIds.filter((id) => !out.has(id));
  if (missing.length) {
    try {
      for (const [id, s] of await ruleSourcesFor(db, officeId, missing)) out.set(id, s);
    } catch (e) {
      console.error("Rule sources not worked out", attemptId, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

import "server-only";

// Builds one training day of an office's scenarios, with the service role,
// after VFDA clicks Build (src/lib/scenario-actions.ts). Fills the master
// scenarios with the office's accepted rules, has Claude write what can't be
// filled mechanically, and replaces the day's office_scenarios as drafts for
// VFDA to review. Never runs on a day a VA has already started.

import { aiErrorMessage } from "@/lib/ai";
import {
  buildOptions,
  writeGrayItems,
  writePhoneDrills,
  writeVariants,
  type Drill,
  type GrayCard,
  type Variant,
} from "@/lib/scenario-ai";
import {
  fillMaster,
  officeDays,
  placeholderValues,
  selectMasters,
  type BuildDay,
  type DayKind,
  type DerivedPlaceholder,
  type DraftScenario,
  type MasterScenario,
  type RuleForBuild,
} from "@/lib/scenario-build";
import { createAdminClient } from "@/lib/supabase/server";
import { officeProfile } from "@/lib/va-flow";

export const GRAY_DAY = "W2D5";
const DRILL_COUNT = 20;
// A build that has said "running" this long is treated as dead and may restart.
const STALE_BUILD_MS = 20 * 60 * 1000;

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const settingOf = (rows: { key: string; value: unknown }[], key: string) => rows.find((r) => r.key === key)?.value;

// What every build needs about an office: its days and how it gets each.
export async function loadOfficeBuild(db: Db, officeId: string) {
  const [office, days, settings] = await Promise.all([
    db
      .from("offices")
      .select("id, name, status, bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool")
      .eq("id", officeId)
      .maybeSingle(),
    db.from("schedule_days").select("code, title, condition, answer_format"),
    db
      .from("settings")
      .select("key, value")
      .in("key", ["sequence", "conditions", "derived_placeholders", "gray_formulas", "gray_split", "gray_fill_rule", "skipped_day_rule"]),
  ]);
  const officeRow = must(office);
  if (!officeRow) return null;
  const settingRows = must(settings) ?? [];
  const conditions = (settingOf(settingRows, "conditions") ?? {}) as Record<string, string>;
  const profile = officeProfile(officeRow);
  return {
    office: officeRow,
    settings: settingRows,
    conditions,
    profile,
    days: officeDays({
      sequence: (settingOf(settingRows, "sequence") ?? []) as string[],
      days: (must(days) ?? []) as BuildDay[],
      conditions,
      profile,
      grayDay: GRAY_DAY,
    }),
  };
}

export async function dayHasAttempts(db: Db, officeId: string, day: string) {
  const { count } = await db
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("office_id", officeId)
    .eq("schedule_day", day);
  return (count ?? 0) > 0;
}

// Marks the day as building. False when another build is already running.
export async function claimBuild(officeId: string, day: string, kind: DayKind): Promise<boolean> {
  const db = createAdminClient();
  await db
    .from("office_days")
    .upsert({ office_id: officeId, schedule_day: day, kind }, { onConflict: "office_id,schedule_day", ignoreDuplicates: true });
  const staleBefore = new Date(Date.now() - STALE_BUILD_MS).toISOString();
  const { data } = await db
    .from("office_days")
    .update({ kind, build_status: "running", build_started_at: new Date().toISOString(), build_error: null })
    .eq("office_id", officeId)
    .eq("schedule_day", day)
    .or(`build_status.neq.running,build_started_at.lt.${staleBefore}`)
    .select("schedule_day");
  return !!data?.length;
}

type Row = Omit<DraftScenario, "options_rule" | "wants_repeat"> & {
  id: string;
  office_id: string;
  schedule_day: string;
  version: "A" | "B";
  is_repeat_variant: boolean;
  parent_scenario_id: string | null;
  test_status: "draft";
};

// Version A drafts become rows, with their version B and repeat variants.
function toRows(officeId: string, day: string, drafts: DraftScenario[], variants: Map<string, Variant>): Row[] {
  const rows: Row[] = [];
  const base = (d: DraftScenario, version: "A" | "B"): Row => {
    const { options_rule: _rule, wants_repeat: _repeat, ...rest } = d;
    void _rule;
    void _repeat;
    return {
      ...rest,
      id: crypto.randomUUID(),
      office_id: officeId,
      schedule_day: day,
      version,
      is_repeat_variant: false,
      parent_scenario_id: null,
      test_status: "draft",
    };
  };
  const repeatOf = (parent: Row, stem: string): Row => ({
    ...parent,
    id: crypto.randomUUID(),
    stem,
    options: null,
    answer: null,
    is_repeat_variant: true,
    parent_scenario_id: parent.id,
  });
  for (const d of drafts) {
    const a = base(d, "A");
    rows.push(a);
    const v = variants.get(d.code);
    if (!v?.b_stem) continue;
    if (v.repeat_stem) rows.push(repeatOf(a, v.repeat_stem));
    const b: Row = {
      ...base(d, "B"),
      stem: v.b_stem,
      options: d.type === "mc" ? v.b_options : null,
      answer: d.type === "mc" ? v.b_answer : null,
    };
    rows.push(b);
    if (v.b_repeat_stem) rows.push(repeatOf(b, v.b_repeat_stem));
  }
  return rows;
}

const grayDraft = (item: { formula: string; type: "mc" | "situational"; stem: string; options: string[] | null; answer: string | null; correct_response: string[] | null; critical_fail: string | null }, card: GrayCard, code: string, position: number): DraftScenario => ({
  scenario_id: null,
  office_workflow_id: card.id,
  workflow: card.code,
  part: card.code,
  part_title: String(card.answers.CARD_NAME ?? card.code),
  code,
  type: item.type,
  points: item.type === "mc" ? 1 : 2,
  answer_format: null,
  stem: item.stem,
  options: item.type === "mc" ? item.options : null,
  answer: item.type === "mc" ? item.answer : null,
  correct_response: item.type === "situational" ? item.correct_response : null,
  critical_fail: item.critical_fail,
  escalation_level: item.critical_fail ? "immediate" : "none",
  formula: item.formula,
  missing_keys: [],
  options_rule: null,
  wants_repeat: item.type === "situational",
  position,
});

const drillDraft = (d: Drill, i: number): DraftScenario => ({
  scenario_id: null,
  office_workflow_id: null,
  workflow: "WF04",
  part: "X",
  part_title: "Extra phone drills",
  code: `X${i + 1}`,
  type: "situational",
  points: 2,
  answer_format: "say_do_book",
  stem: d.stem,
  options: null,
  answer: null,
  correct_response: { Say: d.say, Do: d.do, Book: d.book },
  critical_fail: d.critical_fail,
  escalation_level: d.critical_fail ? "immediate" : "none",
  formula: null,
  missing_keys: [],
  options_rule: null,
  wants_repeat: true,
  position: i,
});

export async function buildOfficeDay(officeId: string, dayCode: string) {
  const db = createAdminClient();
  try {
    const ctx = await loadOfficeBuild(db, officeId);
    const entry = ctx?.days.find((d) => d.day.code === dayCode);
    if (!ctx || !entry) throw new Error("This day isn't part of the office's training.");
    if (await dayHasAttempts(db, officeId, dayCode)) throw new Error("A VA has already started this day; it can't be rebuilt.");

    const [rules, masters, grayCards] = await Promise.all([
      db.from("office_rules").select("rule_slot_key, rule, source_document_id").eq("office_id", officeId).eq("status", "accepted"),
      db
        .from("scenarios")
        .select(
          "id, schedule_day, code, version, workflow, part, part_title, condition, type, stem, options, options_rule, answer, correct_response, critical_fail, escalation_level, points, answer_format, repeat_variant, position",
        )
        .eq("schedule_day", dayCode),
      db.from("office_workflows").select("id, code, risk_tag, card_answers").eq("office_id", officeId).order("position"),
    ]);
    const ruleRows = (must(rules) ?? []) as RuleForBuild[];
    const values = placeholderValues(
      ruleRows,
      (settingOf(ctx.settings, "derived_placeholders") ?? []) as DerivedPlaceholder[],
      officeId,
    );
    const ruleList = Object.entries(values).map(([key, value]) => ({ key, value }));

    let drafts: DraftScenario[];
    if (entry.kind === "standard") {
      drafts = selectMasters((must(masters) ?? []) as MasterScenario[], dayCode, ctx.conditions, ctx.profile).map((m) =>
        fillMaster(m, values),
      );
      // Options built from a rule: only once every rule they use is there.
      const toBuild = drafts.filter((d) => d.options_rule && d.missing_keys.length === 0);
      const built = await buildOptions(toBuild, ruleList);
      for (const d of drafts.filter((x) => x.options_rule)) {
        const o = built.get(d.code);
        if (o) {
          d.options = o.options;
          d.answer = o.answer;
        } else {
          d.options = null;
        }
      }
    } else if (entry.kind === "gray") {
      const cards: GrayCard[] = (must(grayCards) ?? []).map((c) => ({
        id: c.id,
        code: c.code,
        risk_tag: c.risk_tag,
        answers: (c.card_answers ?? {}) as Record<string, unknown>,
      }));
      if (!cards.length) throw new Error("The office has no gray cards yet.");
      const items = await writeGrayItems({
        cards,
        formulas: settingOf(ctx.settings, "gray_formulas"),
        split: settingOf(ctx.settings, "gray_split"),
        fillRule: String(settingOf(ctx.settings, "gray_fill_rule") ?? ""),
        rules: ruleList,
      });
      // Gray items arrive with their version B written alongside.
      const byCard = new Map(cards.map((c) => [c.code, c]));
      const rowsA = items.filter((i) => i.version === "A");
      const rowsB = items.filter((i) => i.version === "B");
      const draftsA = rowsA.map((i, n) => grayDraft(i, byCard.get(i.card)!, `G${n + 1}`, n));
      const draftsB = rowsB.map((i, n) => grayDraft(i, byCard.get(i.card)!, `GB${n + 1}`, n));
      // Repeats only: each version's situational items get their own.
      const repeats = await writeVariants([...draftsA, ...draftsB], ruleList, false);
      const rows: Row[] = [];
      for (const [version, list] of [["A", draftsA], ["B", draftsB]] as const) {
        for (const d of list) {
          const { options_rule: _r, wants_repeat: _w, ...rest } = d;
          void _r;
          void _w;
          const row: Row = { ...rest, id: crypto.randomUUID(), office_id: officeId, schedule_day: dayCode, version, is_repeat_variant: false, parent_scenario_id: null, test_status: "draft" };
          rows.push(row);
          const stem = repeats.get(d.code)?.repeat_stem;
          if (d.type === "situational" && stem) {
            rows.push({ ...row, id: crypto.randomUUID(), stem, is_repeat_variant: true, parent_scenario_id: row.id });
          }
        }
      }
      await replaceDay(db, officeId, dayCode, rows);
      await finishBuild(db, officeId, dayCode);
      return;
    } else {
      const day = entry.day;
      const drills = await writePhoneDrills({
        count: DRILL_COUNT,
        rule: String(settingOf(ctx.settings, "skipped_day_rule") ?? ""),
        dayTitle: day.title,
        rules: ruleList,
      });
      drafts = drills.map(drillDraft);
    }

    // Version B and repeat variants, for items that are complete.
    const complete = drafts.filter((d) => d.missing_keys.length === 0 && (d.type !== "mc" || d.options));
    const variants = await writeVariants(complete, ruleList);
    await replaceDay(db, officeId, dayCode, toRows(officeId, dayCode, drafts, variants));
    await finishBuild(db, officeId, dayCode);
  } catch (e) {
    console.error("Scenario build failed", officeId, dayCode, e);
    await db
      .from("office_days")
      .update({ build_status: "failed", build_error: aiErrorMessage(e).slice(0, 500) })
      .eq("office_id", officeId)
      .eq("schedule_day", dayCode);
  }
}

async function replaceDay(db: Db, officeId: string, day: string, rows: Row[]) {
  if (await dayHasAttempts(db, officeId, day)) throw new Error("A VA started this day during the build; nothing was changed.");
  // Repeat variants go with their parents (on delete cascade).
  must(await db.from("office_scenarios").delete().eq("office_id", officeId).eq("schedule_day", day).eq("is_repeat_variant", false));
  const parents = rows.filter((r) => !r.is_repeat_variant);
  const repeats = rows.filter((r) => r.is_repeat_variant);
  if (parents.length) must(await db.from("office_scenarios").insert(parents));
  if (repeats.length) must(await db.from("office_scenarios").insert(repeats));
}

async function finishBuild(db: Db, officeId: string, day: string) {
  must(
    await db
      .from("office_days")
      .update({ build_status: "done", built_at: new Date().toISOString(), build_error: null, approved_at: null, approved_by: null })
      .eq("office_id", officeId)
      .eq("schedule_day", day),
  );
  // The office moves to scenario review once anything is built.
  await db
    .from("offices")
    .update({ status: "scenarios_in_review" })
    .eq("id", officeId)
    .in("status", ["setup", "rules_in_review", "gap_list"]);
}

import "server-only";

// Builds one training day of an office's scenarios, with the service role,
// after VFDA clicks Build (src/lib/scenario-actions.ts). Card-first: Claude
// writes the day from the office's cards mapped to it, with the master day as
// the pattern (same number of items and multiple choice / situational split),
// the day's workflow fields and the office's VFDA standards; every item keeps
// the card and words it came from. A day with no card mapped falls back to the
// master scenarios filled with the office's rules. The gray card day is written
// from the gray cards (1-2 items each). Replaces the day's office_scenarios as
// drafts for VFDA to review. Never runs on a day a VA has already started.

import { aiErrorMessage } from "@/lib/ai";
import { GRAY_DAY, GRAY_ITEM_CAP, grayPlan, isMustAsk } from "@/lib/card-map";
import {
  buildOptions,
  writeCardDay,
  writeCardGrayItems,
  writeGrayItems,
  writePhoneDrills,
  writeVariants,
  type Drill,
  type GrayCard,
  type CardSource,
  type CheckFailure,
  type Variant,
  type WorkflowFields,
} from "@/lib/scenario-ai";
import {
  cardDrafts,
  fillMaster,
  responseBoxes,
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

export { GRAY_DAY };
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
  test_status: "draft" | "needs_review";
  review_error: string | null;
};

// Drafts become rows, with the repeat variants of situational items.
function toRows(officeId: string, day: string, drafts: DraftScenario[], variants: Map<string, Variant>): Row[] {
  const rows: Row[] = [];
  const base = (d: DraftScenario): Row => {
    const { options_rule: _rule, wants_repeat: _repeat, ...rest } = d;
    void _rule;
    void _repeat;
    return {
      ...rest,
      id: crypto.randomUUID(),
      office_id: officeId,
      schedule_day: day,
      version: "A",
      is_repeat_variant: false,
      parent_scenario_id: null,
      test_status: d.review_error ? "needs_review" : "draft",
      review_error: d.review_error ?? null,
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
    test_status: "draft",
    review_error: null,
  });
  for (const d of drafts) {
    const a = base(d);
    rows.push(a);
    const stem = variants.get(d.code)?.repeat_stem;
    if (d.type === "situational" && stem) rows.push(repeatOf(a, stem));
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
  source_card: null,
  source_quote: null,
  source_document_id: null,
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
  source_card: null,
  source_quote: null,
  source_document_id: null,
});

// What a day is written from: the office's rules, the master day, the cards
// mapped to the day, the workflows and the VFDA standards.
export async function loadDaySources(db: Db, officeId: string, dayCode: string) {
  const ctx = await loadOfficeBuild(db, officeId);
  const entry = ctx?.days.find((d) => d.day.code === dayCode);
  if (!ctx || !entry) throw new Error("This day isn't part of the office's training.");
  const [rules, masters, grayCards, documents, slots, workflowRows] = await Promise.all([
    db
      .from("office_rules")
      .select("rule_slot_key, rule, source_document_id, source")
      .eq("office_id", officeId)
      .eq("status", "accepted"),
    db
      .from("scenarios")
      .select(
        "id, schedule_day, code, version, workflow, part, part_title, condition, type, stem, options, options_rule, answer, correct_response, critical_fail, escalation_level, points, answer_format, repeat_variant, position",
      )
      .eq("schedule_day", dayCode),
    db.from("office_workflows").select("id, code, risk_tag, card_answers").eq("office_id", officeId).order("position"),
    // The cards mapped to this day (read, with process content).
    db
      .from("office_documents")
      .select("id, card_title, file_name, extracted_text, workflow, tags, created_at")
      .eq("office_id", officeId)
      .eq("kind", "card")
      .eq("skip", false)
      .not("imported_at", "is", null)
      .contains("schedule_days", [dayCode])
      .order("created_at"),
    db.from("rule_slots").select("key, tier"),
    db
      .from("workflows")
      .select("code, name, trigger, steps, definition_of_done, va_can_decide, requires_approval, immediate_escalation, prohibited_actions")
      .order("code"),
  ]);
  const ruleRows = (must(rules) ?? []) as RuleForBuild[];
  const values = placeholderValues(
    ruleRows,
    (settingOf(ctx.settings, "derived_placeholders") ?? []) as DerivedPlaceholder[],
    officeId,
  );
  const ruleList = Object.entries(values).map(([key, value]) => ({ key, value }));
  // What Claude may fall back on where the cards are silent: the VFDA
  // standards (as this office has them) and the must-ask rules.
  const tierOf = new Map(((must(slots) ?? []) as { key: string; tier: string }[]).map((s) => [s.key, s.tier]));
  const standards = ruleList.filter((r) => tierOf.get(r.key) === "default" || isMustAsk(r.key));
  const cards: CardSource[] = ((must(documents) ?? []) as {
    id: string;
    card_title: string;
    file_name: string;
    extracted_text: string | null;
    workflow: string | null;
    tags: string[] | null;
  }[])
    .filter((d) => d.extracted_text?.trim())
    .map((d, n, all) => {
      const title = d.card_title || d.file_name;
      // Two cards with the same title: number them so items can name one.
      const same = all.filter((x) => (x.card_title || x.file_name) === title);
      return {
        id: d.id,
        title: same.length > 1 ? `${title} (${same.indexOf(d) + 1})` : title,
        text: d.extracted_text!,
        workflow: d.workflow,
        tags: d.tags ?? [],
      };
    });

  const masterList = (must(masters) ?? []) as MasterScenario[];
  const selected = selectMasters(masterList, dayCode, ctx.conditions, ctx.profile);
  const filled = selected.map((m) => fillMaster(m, values));
  const dayWorkflows = new Set(filled.map((m) => m.workflow));
  return {
    ctx,
    entry,
    values,
    ruleList,
    standards,
    cards,
    filled,
    boxes: responseBoxes(selected),
    grayCards: (must(grayCards) ?? []) as { id: string; code: string; risk_tag: string | null; card_answers: unknown }[],
    workflows: ((must(workflowRows) ?? []) as WorkflowFields[]).filter((w) => dayWorkflows.has(w.code)),
  };
}

// Check failures go to the System log (/admin/logs).
export async function logCheckFailures(db: Db, officeId: string, day: string, failures: CheckFailure[]) {
  if (!failures.length) return;
  const { error } = await db.from("system_logs").insert(
    failures.map((f) => ({
      kind: "scenario_check",
      office_id: officeId,
      schedule_day: day,
      item: f.item.slice(0, 200),
      field: f.field.slice(0, 100),
      value: f.value.slice(0, 2000),
      reason: f.reason.slice(0, 1000),
    })),
  );
  if (error) console.error("System log not written", error.message);
}

export async function buildOfficeDay(officeId: string, dayCode: string) {
  const db = createAdminClient();
  const failures: CheckFailure[] = [];
  const log = (f: CheckFailure) => failures.push(f);
  try {
    if (await dayHasAttempts(db, officeId, dayCode)) throw new Error("A VA has already started this day; it can't be rebuilt.");
    const { ctx, entry, ruleList, standards, cards, filled, boxes, grayCards, workflows } = await loadDaySources(db, officeId, dayCode);

    let drafts: DraftScenario[];
    if (entry.kind === "standard") {
      if (cards.length) {
        // Card-first: the master day is the pattern, the cards the source.
        const items = await writeCardDay({ day: entry.day, masters: filled, cards, workflows, standards, boxes, log });
        drafts = cardDrafts(items, filled);
      } else {
        // No card for this day: the master scenarios, filled with the office's rules.
        drafts = filled;
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
      }
    } else if (entry.kind === "gray" && cards.length) {
      // Gray cards: 1-2 items each, patient-facing or risky cards first.
      const cap = filled.length || GRAY_ITEM_CAP;
      const plan = grayPlan(cards.map((c) => ({ ...c, tags: c.tags ?? [] })), cap);
      const items = await writeCardGrayItems({ cards: plan.map((p) => ({ ...p.card, count: p.count })), standards, log });
      const grayWorkflow = new Map(grayCards.map((g) => [g.code, g.id]));
      drafts = items.map((item, n) => ({
        ...cardDrafts([item], [])[0],
        office_workflow_id: grayWorkflow.get(item.workflow) ?? null,
        part: "G",
        code: `G${n + 1}`,
        position: n,
      }));
    } else if (entry.kind === "gray") {
      const cards: GrayCard[] = grayCards.map((c) => ({
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
      const byCard = new Map(cards.map((c) => [c.code, c]));
      drafts = items.map((i, n) => grayDraft(i, byCard.get(i.card)!, `G${n + 1}`, n));
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

    // Repeat variants, for items that are complete (not for one that needs review).
    const complete = drafts.filter((d) => d.missing_keys.length === 0 && !d.review_error && (d.type !== "mc" || d.options));
    const variants = await writeVariants(complete, ruleList, log);
    await replaceDay(db, officeId, dayCode, toRows(officeId, dayCode, drafts, variants));
    await finishBuild(db, officeId, dayCode);
    await logCheckFailures(db, officeId, dayCode, failures);
  } catch (e) {
    await logCheckFailures(db, officeId, dayCode, failures);
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

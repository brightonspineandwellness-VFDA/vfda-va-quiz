import "server-only";

// Builds one training day of an office's scenarios, with the service role,
// after VFDA clicks Build (src/lib/scenario-actions.ts). Card-first: Claude
// writes the day from the office's cards mapped to it, with the master day as
// the pattern (same number of items, same types), the day's workflow fields
// and the office's VFDA standards; every item keeps the card and words it came
// from. The day rules (settings.day_rules, src/lib/day-rules.ts) decide which
// cards, item types and topics a day may have, and which master items it may
// follow: its own that keep the rules, plus those moved in from other days. A
// day with no card mapped falls back to those master items filled with the
// office's rules. A day with no card that a topic marked "We don't have this
// card" feeds uses the master bank with VFDA's standards instead (the office's
// own values only where VFDA has no standard, e.g. its EHR's name), labeled
// "VFDA standard – office has no card". The gray card day is written from the office's extra cards:
// each one's workflow (src/lib/extra-workflows.ts), once VFDA approved it, gets
// a situational item (process cards: the card's steps are the answer) or a
// question (info only cards), within the day's item count; a phone-call
// process goes to W2D1 or W2D2 instead. Every build is a new build_version of the day's office_scenarios, as
// drafts for VFDA to review; older versions are never changed, so a day can be
// rebuilt after VAs have taken it (they keep their version; new attempts get
// the version VFDA approves next). Practice days (a W2D3 / W2D4 / W2D5 the
// office skips, W2P* / W2W* for VAs whose role leaves a day out,
// src/lib/practice-days.ts) are written fresh from the phone script cards and
// rules, never reusing W2D1 / W2D2, and don't follow the day rules.

import { aiErrorMessage } from "@/lib/ai";
import { GRAY_DAY, GRAY_ITEM_CAP, isMustAsk, NO_CARD_SOURCE, topicDays } from "@/lib/card-map";
import { asDayType, checkBuiltItem, checkDayItem, dayPool, isSource, parseDayRules, ruleFor, type DayRules } from "@/lib/day-rules";
import {
  buildOptions,
  writeCardDay,
  writeGrayItems,
  writePhoneDrills,
  writePracticeDay,
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
  missingSlots,
  neededPractice,
  refillRow,
  responseBoxes,
  officeDays,
  placeholderValues,
  selectMasters,
  type BuildDay,
  type DayKind,
  type DerivedPlaceholder,
  type DraftScenario,
  type FillableRow,
  type MasterScenario,
  type RuleForBuild,
} from "@/lib/scenario-build";
import { phoneDay, planExtraDay, planPhoneItems, type LeftOut } from "@/lib/extra-workflow";
import { extractExtraWorkflows, extraDrafts, loadExtraWorkflows } from "@/lib/extra-workflows";
import { createAdminClient } from "@/lib/supabase/server";
import { officeProfile } from "@/lib/va-flow";
import { normalizeScope, workflowInScope } from "@/lib/va-scope";
import {
  isPracticeCode,
  isWorkflowPracticeCode,
  PHONE_PRACTICE,
  slotOf,
  weakestWorkflows,
  WORKFLOW_PRACTICE_TITLE,
  workflowRank,
  type WorkflowScore,
} from "@/lib/practice-days";

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
  const [office, days, settings, extraCards, vas] = await Promise.all([
    db
      .from("offices")
      .select("id, name, status, bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool")
      .eq("id", officeId)
      .maybeSingle(),
    db.from("schedule_days").select("code, title, condition, answer_format"),
    db
      .from("settings")
      .select("key, value")
      .in("key", ["sequence", "conditions", "derived_placeholders", "gray_formulas", "gray_split", "gray_fill_rule", "skipped_day_rule", "day_rules"]),
    // Extra cards mapped to the gray card day make it the gray card day for the office.
    db
      .from("office_documents")
      .select("id", { count: "exact", head: true })
      .eq("office_id", officeId)
      .eq("kind", "card")
      .eq("skip", false)
      .contains("schedule_days", [GRAY_DAY]),
    // The office's VAs: their roles decide which practice days it needs.
    db.from("profiles").select("va_scope").eq("role", "va").eq("office_id", officeId).is("deactivated_at", null),
  ]);
  const officeRow = must(office);
  if (!officeRow) return null;
  const settingRows = must(settings) ?? [];
  const conditions = (settingOf(settingRows, "conditions") ?? {}) as Record<string, string>;
  const profile = { ...officeProfile(officeRow), ...(extraCards.count ? { HAS_GRAY_CARDS: "yes" } : {}) };
  const dayRows = (must(days) ?? []) as BuildDay[];
  const own = officeDays({
    sequence: (settingOf(settingRows, "sequence") ?? []) as string[],
    days: dayRows,
    conditions,
    profile,
    grayDay: GRAY_DAY,
  });
  const practice = neededPractice({
    days: own,
    scopes: ((must(vas) ?? []) as { va_scope: string[] | null }[]).map((v) => normalizeScope(v.va_scope)),
    practiceDays: dayRows.filter((d) => isPracticeCode(d.code)),
  });
  return {
    office: officeRow,
    settings: settingRows,
    conditions,
    profile,
    dayRules: parseDayRules(settingOf(settingRows, "day_rules")),
    days: [...own, ...practice],
  };
}

// Attempts (archived ones too) on one build version of a day: that version is
// then never changed.
export async function versionHasAttempts(db: Db, officeId: string, day: string, version: number) {
  const { count } = await db
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("office_id", officeId)
    .eq("schedule_day", day)
    .eq("kind", "day")
    .eq("build_version", version);
  return (count ?? 0) > 0;
}

// The day's latest build version (what VFDA reviews) and its live one (what
// new attempts get).
export async function dayVersions(db: Db, officeId: string, day: string) {
  const { data } = await db
    .from("office_days")
    .select("build_version, live_version")
    .eq("office_id", officeId)
    .eq("schedule_day", day)
    .maybeSingle();
  return { latest: (data?.build_version as number | null) ?? null, live: (data?.live_version as number | null) ?? null };
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
  version: "A";
  build_version: number;
  is_repeat_variant: boolean;
  parent_scenario_id: string | null;
  test_status: "draft" | "needs_review";
  review_error: string | null;
};

// Drafts become rows of one build version, with the repeat variants of situational items.
function toRows(officeId: string, day: string, buildVersion: number, drafts: DraftScenario[], variants: Map<string, Variant>): Row[] {
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
      build_version: buildVersion,
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

const grayDraft = (item: { formula: string; type: "mc" | "situational" | "describe"; stem: string; options: string[] | null; answer: string | null; correct_response: string[] | null; critical_fail: string | null }, card: GrayCard, code: string, position: number): DraftScenario => ({
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

// ---------------------------------------------------------------------------
// Practice days (src/lib/practice-days.ts)
// ---------------------------------------------------------------------------

const PRACTICE_SITUATIONAL = 16;
const PRACTICE_MC = 4;
const PHONE_DAYS = ["W2D1", "W2D2"];
// Cards a phone practice day is written from: the phone script cards.
const PHONE_CARD = /phone|script|call/i;
const ESCALATION = /escalat|upset|angry|emergenc|911|red flag|doctor|approv|complain/i;

const latestStems = async (db: Db, officeId: string, days: string[]) => {
  if (!days.length) return [];
  const { data: status } = await db.from("office_days").select("schedule_day, build_version").eq("office_id", officeId).in("schedule_day", days);
  const out: string[] = [];
  for (const s of status ?? []) {
    if (!s.build_version) continue;
    const { data } = await db
      .from("office_scenarios")
      .select("stem")
      .eq("office_id", officeId)
      .eq("schedule_day", s.schedule_day)
      .eq("build_version", s.build_version)
      .eq("version", "A")
      .eq("is_repeat_variant", false);
    out.push(...(data ?? []).map((r) => r.stem as string));
  }
  return out;
};

// A workflow practice day (W2W*): the office's VAs with no Phones role, their
// weakest workflow in their role (1st for W2W3, 2nd for W2W4, 3rd for W2W5).
async function practiceWorkflow(db: Db, officeId: string, dayCode: string): Promise<string> {
  const { data: vas } = await db.from("profiles").select("id, va_scope").eq("role", "va").eq("office_id", officeId).is("deactivated_at", null);
  const needing = (vas ?? []).filter((v) => !normalizeScope(v.va_scope).includes("phones"));
  const allCodes = ["WF01", "WF02", "WF03", "WF05", "WF06", "WF07", "WF08", "WF10"];
  const role = allCodes.filter((code) => needing.some((v) => workflowInScope(normalizeScope(v.va_scope), code)));
  const scores: WorkflowScore[] = [];
  if (needing.length) {
    const { data: attempts } = await db
      .from("attempts")
      .select("id")
      .in("va_id", needing.map((v) => v.id))
      .eq("office_id", officeId)
      .eq("kind", "day")
      .not("submitted_at", "is", null)
      .is("archived_at", null);
    const ids = (attempts ?? []).map((a) => a.id);
    if (ids.length) {
      const { data: items } = await db.from("attempt_items").select("office_scenario_id, first_score").in("attempt_id", ids);
      const scenarioIds = [...new Set((items ?? []).map((i) => i.office_scenario_id))];
      const { data: scen } = scenarioIds.length
        ? await db.from("office_scenarios").select("id, workflow, points").in("id", scenarioIds)
        : { data: [] };
      const byId = new Map((scen ?? []).map((s) => [s.id, s]));
      for (const i of items ?? []) {
        const s = byId.get(i.office_scenario_id);
        if (s && i.first_score !== null) scores.push({ workflow: s.workflow, points: Number(i.first_score), max: Number(s.points) });
      }
    }
  }
  const ranked = weakestWorkflows(role.length ? role : allCodes, scores);
  return ranked[Math.min(workflowRank(dayCode), ranked.length - 1)];
}

async function practiceDrafts(db: Db, officeId: string, dayCode: string, ruleList: { key: string; value: string }[]) {
  const slot = slotOf(dayCode)!;
  const workflowCode = isWorkflowPracticeCode(dayCode) ? await practiceWorkflow(db, officeId, dayCode) : null;
  const [{ data: docs }, { data: wf }] = await Promise.all([
    db
      .from("office_documents")
      .select("id, card_title, file_name, extracted_text, workflow, tags, schedule_days")
      .eq("office_id", officeId)
      .eq("kind", "card")
      .eq("skip", false)
      .not("imported_at", "is", null)
      .order("created_at"),
    workflowCode
      ? db
          .from("workflows")
          .select("code, name, trigger, steps, definition_of_done, va_can_decide, requires_approval, immediate_escalation, prohibited_actions")
          .eq("code", workflowCode)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const all = ((docs ?? []) as { id: string; card_title: string; file_name: string; extracted_text: string | null; workflow: string | null; tags: string[] | null; schedule_days: string[] | null }[])
    .filter((d) => d.extracted_text?.trim())
    .map((d) => ({ id: d.id, title: d.card_title || d.file_name, text: d.extracted_text!, workflow: d.workflow, tags: d.tags ?? [], days: d.schedule_days ?? [] }));
  let cards: typeof all;
  if (workflowCode) {
    cards = all.filter((c) => c.workflow === workflowCode);
  } else {
    // The phone script cards (Texting & Phone Scripts, Master Phone Script), else the cards of the phone days.
    const phoneDays = all.filter((c) => c.days.some((d) => PHONE_DAYS.includes(d) || d === "W1D3"));
    const scripts = phoneDays.filter((c) => PHONE_CARD.test(c.title));
    cards = scripts.length ? scripts : phoneDays.filter((c) => c.days.some((d) => PHONE_DAYS.includes(d)));
  }
  const workflowName = (wf as WorkflowFields | null)?.name ?? workflowCode ?? "";
  const phone = PHONE_PRACTICE[slot];
  const title = workflowCode ? WORKFLOW_PRACTICE_TITLE(workflowName) : phone.title;
  // Never the same situations as the office's other phone days.
  const others = [...PHONE_DAYS, ...["W2D3", "W2D4", "W2D5", "W2P3", "W2P4", "W2P5", "W2W3", "W2W4", "W2W5"].filter((c) => c !== dayCode)];
  const { data: kinds } = await db.from("office_days").select("schedule_day, kind").eq("office_id", officeId).in("schedule_day", others);
  // A real W2D3 / W2D4 / W2D5 (insurance, billing, extra cards) isn't a phone day.
  const avoidDays = others.filter((c) => PHONE_DAYS.includes(c) || isPracticeCode(c) || (kinds ?? []).some((k) => k.schedule_day === c && k.kind === "skipped"));
  const avoid = await latestStems(db, officeId, avoidDays);
  const items = await writePracticeDay({
    title,
    focus: workflowCode
      ? `Extra practice on ${workflowName}, the VA's weakest workflow: everyday and harder situations, mistakes to avoid, when to escalate.`
      : phone.focus,
    situational: PRACTICE_SITUATIONAL,
    mc: PRACTICE_MC,
    cards: cards.map(({ days: _d, ...c }) => {
      void _d;
      return c;
    }),
    workflow: (wf as WorkflowFields | null) ?? null,
    rules: ruleList,
    avoid,
  });
  const cardOf = new Map(cards.map((c) => [c.title.toLowerCase(), c]));
  const drafts = items.map((it, i): DraftScenario => {
    const card = it.source_card ? cardOf.get(it.source_card.toLowerCase()) : undefined;
    const situational = it.type === "situational";
    return {
      scenario_id: null,
      office_workflow_id: null,
      workflow: workflowCode ?? (phone.mode !== "everyday" && ESCALATION.test(`${it.topic} ${it.stem}`) ? "WF09" : "WF04"),
      part: "P",
      part_title: it.topic || title,
      code: `P${i + 1}`,
      type: it.type,
      points: situational ? 2 : 1,
      answer_format: situational ? "say_do_book" : null,
      stem: it.stem,
      options: situational ? null : it.options,
      answer: situational ? null : (it.answer?.trim().toUpperCase() ?? null),
      correct_response: situational ? { Say: it.say, Do: it.do, Book: it.book } : null,
      critical_fail: it.critical_fail,
      escalation_level: it.critical_fail ? "immediate" : "none",
      formula: null,
      missing_keys: [],
      options_rule: null,
      wants_repeat: situational,
      position: i,
      source_card: card?.title ?? null,
      source_quote: null,
      source_document_id: card?.id ?? null,
    };
  });
  return { drafts, title };
}

// What a day is written from: the office's rules, the master items (the day's
// own as slots, and the pool it may follow under the day rules), the cards
// mapped to the day that it may use, the workflows and the VFDA standards.
export async function loadDaySources(db: Db, officeId: string, dayCode: string) {
  const ctx = await loadOfficeBuild(db, officeId);
  const entry = ctx?.days.find((d) => d.day.code === dayCode);
  if (!ctx || !entry) throw new Error("This day isn't part of the office's training.");
  const [rules, masters, grayCards, documents, slotRows, workflowRows, absences] = await Promise.all([
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
      .eq("version", "A"),
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
    db.from("rule_slots").select("key, tier, suggested_answer, default_answer"),
    db
      .from("workflows")
      .select("code, name, trigger, steps, definition_of_done, va_can_decide, requires_approval, immediate_escalation, prohibited_actions")
      .order("code"),
    db.from("office_card_absences").select("card_name").eq("office_id", officeId),
  ]);
  const rule = ruleFor(ctx.dayRules, dayCode);
  const mapped: CardSource[] = ((must(documents) ?? []) as {
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

  // Only the cards the day rules allow (W1D1: Basics and VA Onboarding).
  const cards = mapped.filter((c) => isSource(c.title, rule.sources));

  // Topics the office has no card for that feed this day. With no card for
  // the day at all, it's written from VFDA's master bank and standards.
  const noCard = ((must(absences) ?? []) as { card_name: string }[])
    .map((a) => a.card_name)
    .filter((name) => topicDays(name).includes(dayCode));
  const vfdaOnly = !cards.length && noCard.length > 0;

  const slotList = (must(slotRows) ?? []) as { key: string; tier: string; suggested_answer: unknown; default_answer: unknown }[];
  const vfdaRules: RuleForBuild[] = slotList
    .map((s) => ({ rule_slot_key: s.key, rule: s.suggested_answer ?? s.default_answer, source_document_id: null, source: "vfda_default" }))
    .filter((r) => r.rule !== null && r.rule !== undefined);
  const officeRules = (must(rules) ?? []) as RuleForBuild[];
  // VFDA-only: VFDA's standards, and the office's own values only where VFDA has none.
  const ruleRows = vfdaOnly
    ? [...officeRules.filter((r) => !vfdaRules.some((v) => v.rule_slot_key === r.rule_slot_key)), ...vfdaRules]
    : officeRules;
  const values = placeholderValues(
    ruleRows,
    (settingOf(ctx.settings, "derived_placeholders") ?? []) as DerivedPlaceholder[],
    officeId,
  );
  const ruleList = Object.entries(values).map(([key, value]) => ({ key, value }));
  // What Claude may fall back on where the cards are silent: the VFDA
  // standards and the must-ask rules, without other cards' versions (each
  // card's own protocol is in its text; two cards' rules are never merged).
  const tierOf = new Map(slotList.map((s) => [s.key, s.tier]));
  const fallbackValues = vfdaOnly
    ? values
    : placeholderValues(
        ruleRows.filter((r) => r.source !== "card_import"),
        (settingOf(ctx.settings, "derived_placeholders") ?? []) as DerivedPlaceholder[],
        officeId,
      );
  const standards =
    rule.standards === false
      ? []
      : Object.entries(fallbackValues)
          .map(([key, value]) => ({ key, value }))
          .filter((r) => tierOf.get(r.key) === "default" || isMustAsk(r.key));

  // Every standard day's master items, so items can move between days.
  const masterList = (must(masters) ?? []) as MasterScenario[];
  const byDay = new Map<string, DraftScenario[]>();
  for (const d of ctx.days) {
    if (d.kind !== "standard" && d.day.code !== dayCode) continue;
    byDay.set(d.day.code, selectMasters(masterList, d.day.code, ctx.conditions, ctx.profile).map((m) => fillMaster(m, values)));
  }
  const { slots, pool, moved, dropped } = dayPool({ day: dayCode, byDay, rules: ctx.dayRules });
  const dayWorkflows = new Set([...slots, ...pool].map((m) => m.workflow));
  return {
    ctx,
    entry,
    values,
    ruleList,
    standards,
    cards,
    noCard,
    vfdaOnly,
    rules: ctx.dayRules,
    // The day's own master items, in the day's types: its item count and mix.
    slots,
    pool,
    moved,
    dropped,
    boxes: responseBoxes(selectMasters(masterList, dayCode, ctx.conditions, ctx.profile)),
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

// A day with no card: the master items it may use, up to its own item count
// (its own first). Moved-in items keep their "W1D1.A6" code.
export function fallbackDrafts(slots: DraftScenario[], pool: DraftScenario[]): DraftScenario[] {
  return pool.slice(0, slots.length).map((d, n) => ({ ...d, position: n }));
}

// The legacy gray day (formulas): items in the day's types, and any that break
// the day rules kept for VFDA to review.
export function keepDayRules(drafts: DraftScenario[], day: string, rules: DayRules): DraftScenario[] {
  const rule = ruleFor(rules, day);
  return drafts.map((d) => {
    const t = asDayType(d, rule);
    const broken = checkDayItem(t, day, rules);
    return broken ? { ...t, review_error: `${broken.field}: ${broken.reason}` } : t;
  });
}

export async function buildOfficeDay(officeId: string, dayCode: string) {
  const db = createAdminClient();
  const failures: CheckFailure[] = [];
  const log = (f: CheckFailure) => failures.push(f);
  try {
    const src = await loadDaySources(db, officeId, dayCode);
    const { ctx, entry, ruleList, standards, cards, rules, slots, pool, boxes, grayCards, workflows } = src;
    // Master items the day rules moved away or left out, for the System log.
    for (const m of src.moved) log({ item: `master ${m.code}`, field: "day_rules", value: m.code, reason: `moved to ${m.to}` });
    for (const m of src.dropped) log({ item: `master ${m.code}`, field: "day_rules", value: m.code, reason: `not used: ${m.reason}` });

    let drafts: DraftScenario[];
    let leftOut: LeftOut[] = [];
    // A practice day's name at the office (office_days.title).
    let title: string | null = null;
    if (entry.kind === "standard") {
      if (cards.length) {
        // Card-first: the master items are the pattern, the cards the source.
        const items = await writeCardDay({ day: entry.day, slots, pool, cards, workflows, standards, boxes, rules, log });
        drafts = cardDrafts(items, slots, pool);
      } else {
        // No card for this day: the master items it may use, filled with the office's rules.
        drafts = fallbackDrafts(slots, pool);
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
      // Fewer items than the schedule's count (the day rules moved some away,
      // or Claude wrote too few): extra items from the day's master bank and cards.
      const short = missingSlots(slots, drafts);
      if (short.length) {
        log({
          item: "day",
          field: "items",
          value: `${drafts.length} of ${slots.length}`,
          reason: `fewer items than the schedule's count: ${short.length} more written from the day's master bank${cards.length ? " and cards" : ""}`,
        });
        const extra = await writeCardDay({ day: entry.day, slots: short, pool, cards, workflows, standards, boxes, rules, existing: drafts.map((d) => d.stem), log });
        drafts = [...drafts, ...cardDrafts(extra, short, [])];
      }
      // The office's extra cards whose process is a phone call: trained with the calls.
      const phone = planPhoneItems(await loadExtraWorkflows(db, officeId), dayCode);
      if (phone.length) drafts = [...drafts, ...(await extraDrafts({ day: dayCode, planned: phone, rules, prefix: "X", startAt: drafts.length }))];
      // The office has no card for this day's topics: say so on every question.
      if (src.vfdaOnly) {
        log({ item: "day", field: "source_card", value: src.noCard.join(", "), reason: `no card for ${src.noCard.join(", ")}: written from the VFDA master bank and standards` });
        drafts = drafts.map((d) => ({ ...d, source_card: NO_CARD_SOURCE, source_quote: d.source_quote ?? d.code }));
      }
    } else if (entry.kind === "gray" && cards.length) {
      // Extra cards: each needs its workflow, read and approved by VFDA.
      await extractExtraWorkflows(officeId);
      const extra = await loadExtraWorkflows(db, officeId);
      // Not approved yet (phone processes belong to W2D1 / W2D2, not here).
      const waiting = extra.filter((w) => !w.approved_at && !phoneDay(w));
      if (!extra.some((w) => w.approved_at)) {
        throw new Error(
          extra.length
            ? `Approve the extra cards' workflows first (Cards & rules page): ${waiting.map((w) => w.code).join(", ")}.`
            : "The extra cards' workflows couldn't be read. Try again from the Cards & rules page.",
        );
      }
      // The day's item count, patient-facing and risky process cards first.
      const plan = planExtraDay(extra, slots.length || GRAY_ITEM_CAP);
      leftOut = [...plan.leftOut, ...waiting.map((w) => ({ code: w.code, name: w.name, reason: "not approved yet" }))];
      drafts = await extraDrafts({ day: dayCode, planned: plan.items, rules, prefix: "G", startAt: 0 });
      for (const l of leftOut) log({ item: l.code, field: "extra card", value: l.name, reason: `left out of ${dayCode}: ${l.reason}` });
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
      drafts = keepDayRules(
        items.map((i, n) => grayDraft(i, byCard.get(i.card)!, `G${n + 1}`, n)),
        dayCode,
        rules,
      );
      for (const d of drafts) if (d.review_error) log({ item: d.code, field: d.review_error.split(":")[0], value: d.stem.slice(0, 500), reason: d.review_error });
    } else if (slotOf(dayCode)) {
      // A practice day (W2D3 / W2D4 / W2D5 the office skips, or W2P* / W2W*).
      const practice = await practiceDrafts(db, officeId, dayCode, ruleList);
      drafts = practice.drafts;
      title = practice.title;
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
    const version = await nextVersion(db, officeId, dayCode);
    await insertVersion(db, toRows(officeId, dayCode, version, drafts, variants));
    await finishBuild(db, officeId, dayCode, version);
    // Extra cards that didn't fit (shown on the day's review page).
    await db.from("office_days").update({ left_out: leftOut }).eq("office_id", officeId).eq("schedule_day", dayCode);
    // The practice day's name (no title column before practice-days.sql: the default names stand).
    if (title) await db.from("office_days").update({ title }).eq("office_id", officeId).eq("schedule_day", dayCode);
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

// One more than any version of the day so far.
async function nextVersion(db: Db, officeId: string, day: string) {
  const { data } = await db
    .from("office_scenarios")
    .select("build_version")
    .eq("office_id", officeId)
    .eq("schedule_day", day)
    .order("build_version", { ascending: false })
    .limit(1);
  const { latest } = await dayVersions(db, officeId, day);
  return Math.max(Number(data?.[0]?.build_version ?? 0), latest ?? 0) + 1;
}

// A new version is only ever added: older versions stay as they are.
async function insertVersion(db: Db, rows: Row[]) {
  const parents = rows.filter((r) => !r.is_repeat_variant);
  const repeats = rows.filter((r) => r.is_repeat_variant);
  if (parents.length) must(await db.from("office_scenarios").insert(parents));
  if (repeats.length) must(await db.from("office_scenarios").insert(repeats));
}

// The new version is the one VFDA reviews; the live version (if any) stays
// live for VAs until VFDA approves the new one.
async function finishBuild(db: Db, officeId: string, day: string, version: number) {
  must(
    await db
      .from("office_days")
      .update({ build_status: "done", built_at: new Date().toISOString(), build_error: null, build_version: version })
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

// Every built day of every office, rechecked against the day rules (its
// latest version): an item that breaks them needs review (with the reason,
// logged), and a live version with such an item goes back to draft for VFDA.
// A version a VA has taken, and skipped days (phone drills), are left alone.
export async function recheckBuiltDays(db: Db) {
  const built =
    must(await db.from("office_days").select("office_id, schedule_day, kind, build_version, live_version").eq("build_status", "done")) ?? [];
  const rulesByOffice = new Map<string, DayRules>();
  let flagged = 0;
  let reopened = 0;
  let started = 0;
  for (const d of built) {
    if (d.kind === "skipped" || d.kind === "practice") continue;
    const version = (d.build_version as number | null) ?? 1;
    if (await versionHasAttempts(db, d.office_id, d.schedule_day, version)) {
      started++;
      continue;
    }
    if (!rulesByOffice.has(d.office_id)) rulesByOffice.set(d.office_id, (await loadOfficeBuild(db, d.office_id))?.dayRules ?? parseDayRules(null));
    const rules = rulesByOffice.get(d.office_id)!;
    const rows =
      must(
        await db
          .from("office_scenarios")
          .select("id, code, type, stem, source_card, part_title, test_status")
          .eq("office_id", d.office_id)
          .eq("schedule_day", d.schedule_day)
          .eq("build_version", version)
          .eq("is_repeat_variant", false),
      ) ?? [];
    const failures: CheckFailure[] = [];
    for (const r of rows) {
      if (r.test_status === "needs_review") continue;
      const broken = checkBuiltItem(r, d.schedule_day, rules);
      if (!broken) continue;
      failures.push({ item: r.code, field: broken.field, value: broken.value, reason: broken.reason });
      must(
        await db
          .from("office_scenarios")
          .update({ test_status: "needs_review", review_error: `${broken.field}: ${broken.reason}` })
          .eq("id", r.id),
      );
    }
    if (!failures.length) continue;
    flagged += failures.length;
    await logCheckFailures(db, d.office_id, d.schedule_day, failures);
    if (d.live_version === version) {
      // Back to draft: VAs wait for it ("Your quiz is being prepared") until VFDA approves it again.
      must(
        await db
          .from("office_scenarios")
          .update({ test_status: "draft" })
          .eq("office_id", d.office_id)
          .eq("schedule_day", d.schedule_day)
          .eq("build_version", version)
          .eq("test_status", "live"),
      );
      must(
        await db
          .from("office_days")
          .update({ approved_at: null, approved_by: null, live_version: null })
          .eq("office_id", d.office_id)
          .eq("schedule_day", d.schedule_day),
      );
      reopened++;
    }
  }
  return { flagged, reopened, started };
}

// The office's rule values, as a build fills them (accepted rules plus
// settings.derived_placeholders).
export async function officeValues(db: Db, officeId: string) {
  const [rules, settings] = await Promise.all([
    db.from("office_rules").select("rule_slot_key, rule, source_document_id, source").eq("office_id", officeId).eq("status", "accepted"),
    db.from("settings").select("key, value").eq("key", "derived_placeholders"),
  ]);
  return placeholderValues(
    (must(rules) ?? []) as RuleForBuild[],
    (settingOf(must(settings) ?? [], "derived_placeholders") ?? []) as DerivedPlaceholder[],
    officeId,
  );
}

// Every scenario of the office still waiting for rules, refilled with the
// rules it has now (no rebuild). Live scenarios never wait for rules.
// Returns the scenarios changed and those now complete.
export async function refillOffice(db: Db, officeId: string) {
  const values = await officeValues(db, officeId);
  const rows =
    must(
      await db
        .from("office_scenarios")
        .select("id, stem, options, answer, correct_response, critical_fail, missing_keys, test_status")
        .eq("office_id", officeId)
        .neq("test_status", "live"),
    ) ?? [];
  const changed: string[] = [];
  const complete: string[] = [];
  for (const row of rows) {
    if (!row.missing_keys?.length) continue;
    const patch = refillRow(row as FillableRow, values);
    if (!patch) continue;
    must(await db.from("office_scenarios").update(patch).eq("id", row.id).neq("test_status", "live"));
    changed.push(row.id);
    if (!patch.missing_keys.length) complete.push(row.id);
  }
  return { changed, complete, values };
}

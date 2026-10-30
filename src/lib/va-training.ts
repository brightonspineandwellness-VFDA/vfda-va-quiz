import "server-only";

// VA training on the server: loads the VA's days, opens the next one when
// every unlock rule holds, serves scenarios one at a time, grades answers and
// works out the day result. Uses the service role, so every function here
// checks the VA itself and returns only what the VA may see: never answer,
// correct_response, critical_fail or options_rule.

import { gradeSituational } from "@/lib/ai";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  addTrainingDays,
  ANSWER_BOXES,
  buildToday,
  certificationRules,
  cleanPasteLog,
  dayResult,
  isFast,
  nextItem,
  normalSeconds,
  officeProfile,
  optionLetter,
  secondsBetween,
  shuffleOrder,
  todayIn,
  trainingPath,
  type AnswerFormat,
  type DayRow,
  type DayView,
  type Feedback,
  type ItemProgress,
  type ProofRow,
  type ServedItem,
  type UnlockRow,
} from "@/lib/va-flow";

export const PROOF_BUCKET = "proof-of-work";
// Training days are calendar days here. Set TRAINING_TIME_ZONE in Vercel to change it.
const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";

type Db = ReturnType<typeof createAdminClient>;

const DAY_COLUMNS =
  "code, week, day, title, cards, condition, max_points, pass_points, review_min_points, answer_format, proof_of_work";
const UNLOCK_COLUMNS = "schedule_day, version, status, cards_done_at, unlocked_at, opens_on";
const PROOF_COLUMNS = "id, schedule_day, file_path, file_name, link_url, status, review_note, created_at";
// What the VA's browser may see of a scenario.
const DISPLAY_COLUMNS = "id, type, points, answer_format, stem, options, workflow, part_title, code";

type DisplayScenario = {
  id: string;
  type: "mc" | "situational";
  points: number;
  answer_format: AnswerFormat | null;
  stem: string;
  options: unknown;
  workflow: string;
  part_title: string;
  code: string;
};

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const settingValue = (rows: { key: string; value: unknown }[], key: string) => rows.find((r) => r.key === key)?.value;

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export async function loadToday(user: CurrentUser) {
  const db = createAdminClient();
  if (!user.officeId) return { kind: "no_office" as const };
  const officeId = user.officeId;

  const [profile, office, days, settings, unlocks, proofs, scenarios] = await Promise.all([
    db.from("profiles").select("va_start_date").eq("id", user.id).maybeSingle(),
    db
      .from("offices")
      .select("name, bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool")
      .eq("id", officeId)
      .maybeSingle(),
    db.from("schedule_days").select(DAY_COLUMNS),
    db.from("settings").select("key, value").in("key", ["conditions", "sequence"]),
    db.from("day_unlocks").select(UNLOCK_COLUMNS).eq("va_id", user.id),
    db.from("proof_uploads").select(PROOF_COLUMNS).eq("va_id", user.id).order("created_at"),
    db
      .from("office_scenarios")
      .select("schedule_day, version, test_status")
      .eq("office_id", officeId)
      .eq("is_repeat_variant", false),
  ]);
  const officeRow = must(office);
  if (!officeRow) return { kind: "no_office" as const };
  const settingRows = must(settings) ?? [];
  const scenarioRows = must(scenarios) ?? [];

  // A day (in one version) is approved once VFDA has set all its scenarios live.
  const byDayVersion = new Map<string, string[]>();
  for (const s of scenarioRows) {
    const k = `${s.schedule_day}:${s.version}`;
    byDayVersion.set(k, [...(byDayVersion.get(k) ?? []), s.test_status]);
  }
  const approved = new Set([...byDayVersion].filter(([, st]) => st.every((x) => x === "live")).map(([k]) => k));

  const path = trainingPath({
    sequence: (settingValue(settingRows, "sequence") as string[] | undefined) ?? [],
    days: (must(days) ?? []) as DayRow[],
    conditions: (settingValue(settingRows, "conditions") as Record<string, string> | undefined) ?? {},
    profile: officeProfile(officeRow),
    officeScenarioDays: new Set(scenarioRows.map((s) => s.schedule_day)),
  });
  const proofRows = (must(proofs) ?? []) as ProofRow[];
  const date = todayIn(TIME_ZONE);
  const today = buildToday({
    path,
    unlocks: (must(unlocks) ?? []) as UnlockRow[],
    proofs: proofRows,
    approved,
    startDate: must(profile)?.va_start_date ?? null,
    today: date,
  });

  // Every rule holds: open the day (once).
  if (today.kind === "open" && today.current.status !== "open") {
    const { data: opened, error } = await db
      .from("day_unlocks")
      .update({ status: "open", unlocked_at: new Date().toISOString() })
      .eq("va_id", user.id)
      .eq("schedule_day", today.current.day.code)
      .in("status", ["locked", "retake"])
      .select("status");
    if (error) throw new Error(error.message);
    if (opened?.length) today.current.status = "open";
  }

  return { kind: "ok" as const, officeName: officeRow.name as string, today, proofs: proofRows, date };
}

// "Mark today's cards done" for the day the VA is waiting on.
export async function markCardsDone(user: CurrentUser): Promise<string | null> {
  const loaded = await loadToday(user);
  if (loaded.kind !== "ok") return "Your account isn't linked to an office yet.";
  const { today } = loaded;
  if (today.kind !== "blocked") return today.kind === "open" ? null : "There's no day waiting for its cards.";
  const day = today.current;
  if (day.unlock?.cards_done_at) return null;

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = day.unlock
    ? await db
        .from("day_unlocks")
        .update({ cards_done_at: now })
        .eq("va_id", user.id)
        .eq("schedule_day", day.day.code)
        .is("cards_done_at", null)
    : await db
        .from("day_unlocks")
        .upsert(
          { va_id: user.id, schedule_day: day.day.code, version: "A", status: "locked", cards_done_at: now },
          { onConflict: "va_id,schedule_day", ignoreDuplicates: true },
        );
  if (error) return "Couldn't save. Try again.";
  // Opens the day now if nothing else is in the way.
  await loadToday(user);
  return null;
}

// ---------------------------------------------------------------------------
// The scenario screen
// ---------------------------------------------------------------------------

type DayContext = {
  db: Db;
  user: CurrentUser & { officeId: string };
  current: DayView;
  attempt: { id: string; started_at: string; submitted_at: string | null };
  scenarios: DisplayScenario[];
  items: (ItemProgress & {
    id: string;
    first_feedback: StoredFeedback | null;
    served_at: string | null;
    repeat_served_at: string | null;
  })[];
};

const ITEM_COLUMNS =
  "id, office_scenario_id, first_answer, first_score, first_feedback, repeat_scenario_id, repeat_answer, served_at, repeat_served_at";

// The open day, its attempt (created on first visit), its scenarios and the
// VA's answers so far. Null when no day is open for this VA.
async function openDay(user: CurrentUser): Promise<DayContext | null> {
  const loaded = await loadToday(user);
  if (loaded.kind !== "ok" || loaded.today.kind !== "open" || !user.officeId) return null;
  const current = loaded.today.current;
  const db = createAdminClient();
  const officeId = user.officeId;
  const key = { va_id: user.id, schedule_day: current.day.code, version: current.version };

  await db.from("attempts").upsert({ ...key, office_id: officeId }, { onConflict: "va_id,schedule_day,version", ignoreDuplicates: true });
  const [attempt, scenarios] = await Promise.all([
    db.from("attempts").select("id, started_at, submitted_at").match(key).single(),
    db
      .from("office_scenarios")
      .select(DISPLAY_COLUMNS)
      .eq("office_id", officeId)
      .eq("schedule_day", current.day.code)
      .eq("version", current.version)
      .eq("is_repeat_variant", false)
      .eq("test_status", "live")
      .order("position")
      .order("code"),
  ]);
  const attemptRow = must(attempt) as DayContext["attempt"];
  const items = must(await db.from("attempt_items").select(ITEM_COLUMNS).eq("attempt_id", attemptRow.id));
  return {
    db,
    user: { ...user, officeId },
    current,
    attempt: attemptRow,
    scenarios: (must(scenarios) ?? []) as DisplayScenario[],
    items: (items ?? []) as DayContext["items"],
  };
}

function toServed(
  ctx: DayContext,
  parent: DisplayScenario,
  shown: DisplayScenario,
  phase: "first" | "repeat",
  priorFeedback: Feedback | null,
): ServedItem {
  const raw = Array.isArray(shown.options) ? (shown.options as unknown[]).map(String) : null;
  const options = raw ? shuffleOrder(`${ctx.user.id}:${shown.id}`, raw.length).map((i) => raw[i]) : null;
  return {
    scenarioId: parent.id,
    phase,
    number: ctx.scenarios.findIndex((s) => s.id === parent.id) + 1,
    total: ctx.scenarios.length,
    dayCode: ctx.current.day.code,
    dayTitle: ctx.current.day.title,
    workflow: shown.workflow,
    partTitle: shown.part_title,
    type: shown.type,
    format: shown.answer_format ?? ctx.current.day.answer_format,
    stem: shown.stem,
    options,
    priorFeedback,
  };
}

async function repeatScenario(ctx: DayContext, id: string) {
  const { data } = await ctx.db
    .from("office_scenarios")
    .select(DISPLAY_COLUMNS)
    .eq("id", id)
    .eq("office_id", ctx.user.officeId)
    .eq("is_repeat_variant", true)
    .maybeSingle();
  return data as DisplayScenario | null;
}

// attempt_items keeps feedback as {reason, missed_steps}.
type StoredFeedback = { reason?: string; missed_steps?: string[]; ungraded?: boolean };

const storedFeedback = (f: StoredFeedback | null): Feedback | null =>
  f && {
    reason: f.reason ?? "",
    missedSteps: f.missed_steps ?? [],
    repeatNext: true,
    ungraded: !!f.ungraded,
  };

export type DayScreen =
  | { kind: "closed" }
  | { kind: "empty"; dayCode: string }
  | { kind: "item"; item: ServedItem }
  | { kind: "finished"; result: FinishedDay };

// What the scenario screen shows now. Records when each item is first shown,
// so time per item is measured on the server.
export async function loadDayScreen(user: CurrentUser): Promise<DayScreen> {
  const ctx = await openDay(user);
  if (!ctx) return { kind: "closed" };
  if (ctx.scenarios.length === 0) return { kind: "empty", dayCode: ctx.current.day.code };
  const next = nextItem(ctx.scenarios, ctx.items);
  if (!next) return { kind: "finished", result: await finishDay(ctx) };

  if (next.phase === "first") {
    if (!next.item) {
      await ctx.db.from("attempt_items").upsert(
        {
          attempt_id: ctx.attempt.id,
          office_scenario_id: next.scenario.id,
          position: ctx.scenarios.indexOf(next.scenario),
          served_at: new Date().toISOString(),
        },
        { onConflict: "attempt_id,office_scenario_id", ignoreDuplicates: true },
      );
    }
    return { kind: "item", item: toServed(ctx, next.scenario, next.scenario, "first", null) };
  }
  const item = ctx.items.find((i) => i.office_scenario_id === next.scenario.id)!;
  const repeat = await repeatScenario(ctx, item.repeat_scenario_id!);
  if (!repeat) return { kind: "closed" };
  return { kind: "item", item: toServed(ctx, next.scenario, repeat, "repeat", storedFeedback(item.first_feedback)) };
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

export type SubmittedAnswer = { choice?: number; boxes?: Record<string, string>; pastes?: unknown };
export type SubmitOutcome = { feedback: Feedback | null; repeat: ServedItem | null };

const MAX_BOX_CHARS = 5000;

async function gradingSettings(db: Db) {
  const rows = must(await db.from("settings").select("key, value").in("key", ["grading", "certification"])) ?? [];
  const grading = (settingValue(rows, "grading") ?? {}) as Record<string, unknown>;
  const certification = (settingValue(rows, "certification") ?? {}) as Record<string, unknown>;
  return {
    rules: certificationRules(grading),
    rubric: String(grading.situational_rubric ?? ""),
    gradingRules: Array.isArray(grading.rules) ? grading.rules.map(String) : [],
    navigationRule: String(certification.navigation_rule ?? "Don't grade exact buttons or click paths."),
  };
}

const ruleText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("; ");
  if (value && typeof value === "object" && "text" in value) {
    const v = value as { text: string; links?: string[] };
    return [v.text, ...(v.links ?? [])].filter(Boolean).join(" ");
  }
  return JSON.stringify(value);
};

// The office's accepted rules for one workflow, for the grader.
async function officeRulesFor(db: Db, officeId: string, workflow: string) {
  const slots = must(await db.from("rule_slots").select("key").contains("workflows", [workflow])) ?? [];
  if (!slots.length) return [];
  const rows =
    must(
      await db
        .from("office_rules")
        .select("rule_slot_key, rule, source_document_id")
        .eq("office_id", officeId)
        .eq("status", "accepted")
        .in(
          "rule_slot_key",
          slots.map((s) => s.key),
        ),
    ) ?? [];
  // A direct answer (doctor or VFDA) wins over a card's version.
  const sorted = [...rows].sort((a, b) => Number(!!a.source_document_id) - Number(!!b.source_document_id));
  const seen = new Set<string>();
  return sorted
    .filter((r) => !seen.has(r.rule_slot_key) && seen.add(r.rule_slot_key))
    .map((r) => ({ key: r.rule_slot_key as string, value: ruleText(r.rule) }));
}

const UNGRADED: Feedback = {
  reason: "We couldn't grade this answer automatically. VFDA will review it.",
  missedSteps: [],
  repeatNext: false,
  ungraded: true,
};

export async function submitAnswer(
  user: CurrentUser,
  scenarioId: string,
  phase: "first" | "repeat",
  answer: SubmittedAnswer,
): Promise<{ ok: true; data: SubmitOutcome } | { ok: false; error: string }> {
  const ctx = await openDay(user);
  if (!ctx) return { ok: false, error: "No day is open for you right now." };
  const next = nextItem(ctx.scenarios, ctx.items);
  // No going back, no skipping ahead: only the item on screen can be answered, once.
  if (!next || next.scenario.id !== scenarioId || next.phase !== phase) {
    return { ok: false, error: "This item was already answered. Moving on to the next one." };
  }
  const item = ctx.items.find((i) => i.office_scenario_id === scenarioId);
  if (!item) return { ok: false, error: "Reload the page and try again." };
  const shownId = phase === "first" ? scenarioId : item.repeat_scenario_id!;
  const { data: key } = await ctx.db
    .from("office_scenarios")
    .select("type, answer_format, options, answer, correct_response, critical_fail, escalation_level, workflow, stem")
    .eq("id", shownId)
    .eq("office_id", ctx.user.officeId)
    .maybeSingle();
  if (!key) return { ok: false, error: "This scenario is no longer available." };
  const now = new Date();
  const settings = await gradingSettings(ctx.db);

  // Multiple choice: compare to the stored answer.
  if (key.type === "mc") {
    const options = Array.isArray(key.options) ? (key.options as unknown[]).map(String) : [];
    const k = answer.choice;
    if (phase !== "first" || typeof k !== "number" || !Number.isInteger(k) || k < 0 || k >= options.length) {
      return { ok: false, error: "Pick one of the answers." };
    }
    const original = shuffleOrder(`${user.id}:${shownId}`, options.length)[k];
    const letter = optionLetter(original);
    const { data: saved } = await ctx.db
      .from("attempt_items")
      .update({
        first_answer: { choice: letter, text: options[original] },
        first_score: letter === String(key.answer ?? "").trim().toUpperCase() ? settings.rules.mcPoints : 0,
        time_per_item: secondsBetween(item.served_at, now),
      })
      .eq("id", item.id)
      .is("first_answer", null)
      .select("id");
    if (!saved?.length) return { ok: false, error: "This item was already answered. Moving on to the next one." };
    return { ok: true, data: { feedback: null, repeat: null } };
  }

  // Situational: the boxes for this answer format.
  const format: AnswerFormat = (key.answer_format as AnswerFormat | null) ?? ctx.current.day.answer_format;
  const boxes = ANSWER_BOXES[format];
  const given = answer.boxes ?? {};
  const texts = boxes.map((b) => ({ key: b.key, label: b.label, text: String(given[b.key] ?? "").slice(0, MAX_BOX_CHARS) }));
  if (!texts.some((t) => t.text.trim())) return { ok: false, error: "Write your answer in the boxes first." };
  const stored = Object.fromEntries(texts.map((t) => [t.key, t.text]));
  const pastes = cleanPasteLog(answer.pastes, boxes.map((b) => b.key)).map((p) => ({ ...p, phase }));

  // Claim the answer before grading, so a double submit can't grade twice.
  const claim =
    phase === "first"
      ? { first_answer: stored, time_per_item: secondsBetween(item.served_at, now) }
      : { repeat_answer: stored, repeat_time: secondsBetween(item.repeat_served_at, now) };
  const { data: claimed } = await ctx.db
    .from("attempt_items")
    .update(claim)
    .eq("id", item.id)
    .is(phase === "first" ? "first_answer" : "repeat_answer", null)
    .select("paste_log, critical_error, critical_quote, ai_confidence")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "This item was already answered. Moving on to the next one." };

  const grade = await gradeSituational({
    stem: key.stem,
    boxes: texts,
    correctResponse: key.correct_response,
    criticalFail: key.critical_fail,
    escalationLevel: key.escalation_level,
    officeRules: await officeRulesFor(ctx.db, ctx.user.officeId, key.workflow),
    rubric: settings.rubric,
    rules: settings.gradingRules,
    navigationRule: settings.navigationRule,
  });

  // Below 2/2 on the first try: the repeat variant comes right away.
  let repeat: DisplayScenario | null = null;
  if (phase === "first" && grade && grade.score < 2) {
    const { data } = await ctx.db
      .from("office_scenarios")
      .select(DISPLAY_COLUMNS)
      .eq("parent_scenario_id", scenarioId)
      .eq("is_repeat_variant", true)
      .eq("test_status", "live")
      .maybeSingle();
    repeat = data as DisplayScenario | null;
  }

  const feedback: Feedback = grade
    ? {
        reason: grade.reason,
        missedSteps: grade.score < 2 ? grade.missed_steps : [],
        repeatNext: !!repeat,
        ungraded: false,
      }
    : UNGRADED;
  const stamp = { reason: feedback.reason, missed_steps: feedback.missedSteps };
  const confidence = grade ? Math.round(grade.confidence * 100) / 100 : null;
  const update =
    phase === "first"
      ? {
          first_score: grade?.score ?? null,
          first_feedback: grade ? stamp : { ...stamp, ungraded: true },
          critical_error: grade?.critical_error ?? false,
          critical_quote: grade?.critical_error ? grade.critical_quote : null,
          ai_confidence: confidence,
          repeat_scenario_id: repeat?.id ?? null,
          repeat_served_at: repeat ? new Date().toISOString() : null,
        }
      : {
          repeat_score: grade?.score ?? null,
          repeat_feedback: grade ? stamp : { ...stamp, ungraded: true },
          critical_error: claimed.critical_error || (grade?.critical_error ?? false),
          critical_quote: claimed.critical_quote ?? (grade?.critical_error ? grade.critical_quote : null),
          // The lower of the two grades' confidence decides whether VFDA looks.
          ai_confidence:
            confidence === null || claimed.ai_confidence === null ? null : Math.min(confidence, Number(claimed.ai_confidence)),
        };
  const { error } = await ctx.db
    .from("attempt_items")
    .update({ ...update, paste_log: [...((claimed.paste_log as unknown[]) ?? []), ...pastes] })
    .eq("id", item.id);
  if (error) return { ok: false, error: "Couldn't save your grade. Reload the page." };

  if (!repeat) return { ok: true, data: { feedback, repeat: null } };
  const parent = ctx.scenarios.find((s) => s.id === scenarioId)!;
  return { ok: true, data: { feedback, repeat: toServed(ctx, parent, repeat, "repeat", feedback) } };
}

// ---------------------------------------------------------------------------
// End of the day
// ---------------------------------------------------------------------------

export type FinishedDay = { dayCode: string; result: "pass" | "review" | "retake"; version: "A" | "B"; retakeOn: string | null };

async function finishDay(ctx: DayContext): Promise<FinishedDay> {
  const { db, current, attempt } = ctx;
  const now = new Date();
  const base = { dayCode: current.day.code, version: current.version };

  // Claim the finish, so it is worked out once.
  const { data: claimed } = await db
    .from("attempts")
    .update({ submitted_at: now.toISOString() })
    .eq("id", attempt.id)
    .is("submitted_at", null)
    .select("id");
  if (!claimed?.length) {
    const { data } = await db.from("attempts").select("result").eq("id", attempt.id).single();
    return { ...base, result: data?.result ?? "review", retakeOn: null };
  }

  const settings = await gradingSettings(db);
  const full =
    must(
      await db
        .from("attempt_items")
        .select("id, office_scenario_id, first_score, repeat_score, critical_error, ai_confidence, time_per_item, repeat_time, paste_log")
        .eq("attempt_id", attempt.id),
    ) ?? [];
  const masters =
    must(
      await db
        .from("office_scenarios")
        .select("id, scenario_id")
        .in(
          "id",
          ctx.scenarios.map((s) => s.id),
        ),
    ) ?? [];
  const masterOf = new Map(masters.map((m) => [m.id, m.scenario_id as string | null]));
  const typeOf = new Map(ctx.scenarios.map((s) => [s.id, s]));

  // Normal time per item: other VAs' times on the same master scenario.
  const masterIds = [...new Set(masters.map((m) => m.scenario_id).filter(Boolean))] as string[];
  const siblings = masterIds.length
    ? (must(await db.from("office_scenarios").select("id, scenario_id").in("scenario_id", masterIds).eq("is_repeat_variant", false)) ?? [])
    : [];
  const samples = siblings.length
    ? (must(
        await db
          .from("attempt_items")
          .select("office_scenario_id, time_per_item")
          .in(
            "office_scenario_id",
            siblings.map((s) => s.id),
          )
          .neq("attempt_id", attempt.id)
          .not("time_per_item", "is", null)
          .limit(5000),
      ) ?? [])
    : [];
  const siblingMaster = new Map(siblings.map((s) => [s.id, s.scenario_id as string]));
  const samplesFor = (master: string | null) =>
    master ? samples.filter((s) => siblingMaster.get(s.office_scenario_id) === master).map((s) => s.time_per_item as number) : [];

  let normalTotal = 0;
  let spentTotal = 0;
  const fastIds: string[] = [];
  for (const i of full) {
    const s = typeOf.get(i.office_scenario_id);
    if (!s) continue;
    const normal = normalSeconds(s.type, samplesFor(masterOf.get(i.office_scenario_id) ?? null));
    normalTotal += normal;
    spentTotal += i.time_per_item ?? 0;
    if (i.time_per_item !== null && isFast(i.time_per_item, normal)) fastIds.push(i.id);
  }
  if (fastIds.length) await db.from("attempt_items").update({ fast: true }).in("id", fastIds);

  const outcome = dayResult(
    current.day,
    full
      .filter((i) => typeOf.has(i.office_scenario_id))
      .map((i) => ({
        type: typeOf.get(i.office_scenario_id)!.type,
        points: typeOf.get(i.office_scenario_id)!.points,
        first_score: i.first_score,
        repeat_score: i.repeat_score,
        critical_error: i.critical_error,
        ai_confidence: i.ai_confidence === null ? null : Number(i.ai_confidence),
      })),
    settings.rules,
  );
  const pastes = full.flatMap((i) =>
    ((i.paste_log as Record<string, unknown>[]) ?? []).map((p) => ({ ...p, code: typeOf.get(i.office_scenario_id)?.code })),
  );
  await db
    .from("attempts")
    .update({
      first_try_points: outcome.points,
      max_points: outcome.max,
      result: outcome.result,
      critical_errors: outcome.criticalErrors,
      time_spent: secondsBetween(attempt.started_at, now),
      paste_log: pastes,
      fast_finish: normalTotal > 0 && isFast(spentTotal, normalTotal),
    })
    .eq("id", attempt.id);

  // Move the day on. A first retake opens version B the next training day;
  // failing version B goes to VFDA for a call.
  let retakeOn: string | null = null;
  let unlock: Record<string, unknown>;
  if (outcome.result === "pass") unlock = { status: "passed" };
  else if (outcome.result === "retake" && current.version === "A") {
    retakeOn = addTrainingDays(todayIn(TIME_ZONE), 1);
    unlock = { status: "retake", version: "B", opens_on: retakeOn, unlocked_at: null };
  } else unlock = { status: "in_review" };
  await db
    .from("day_unlocks")
    .update(unlock)
    .eq("va_id", ctx.user.id)
    .eq("schedule_day", current.day.code)
    .eq("status", "open");

  return { ...base, result: outcome.result, retakeOn };
}

// ---------------------------------------------------------------------------
// VFDA decisions on a day in review (admin pages).
// ---------------------------------------------------------------------------

export function nextTrainingDay() {
  return addTrainingDays(todayIn(TIME_ZONE), 1);
}

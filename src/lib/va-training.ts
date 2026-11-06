import "server-only";

// VA training on the server: loads the VA's days, opens the next one once the
// day before it was submitted, its cards are marked done and VFDA approved it
// for the office, serves scenarios one at a time, grades answers and labels
// the day, and prepares a day's one optional retake. Quizzes never block.
// Uses the service role, so every function here
// checks the VA itself and returns only what the VA may see: never answer,
// correct_response, critical_fail or options_rule.

import { aiErrorMessage, CONFIDENCE_VALUE, gradeSituational } from "@/lib/ai";
import type { CurrentUser } from "@/lib/auth";
import { recalculateCertifications } from "@/lib/certifications";
import { writeRetakeVariants } from "@/lib/scenario-ai";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeScope } from "@/lib/va-scope";
import {
  addTrainingDays,
  ANSWER_BOXES,
  formatOf,
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
  type ResultLabel,
  type ServedItem,
  type UnlockRow,
} from "@/lib/va-flow";

export const PROOF_BUCKET = "proof-of-work";
// Training days are calendar days here. Set TRAINING_TIME_ZONE in Vercel to change it.
const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";

type Db = ReturnType<typeof createAdminClient>;

const DAY_COLUMNS =
  "code, week, day, title, cards, condition, max_points, pass_points, review_min_points, answer_format, proof_of_work";
const UNLOCK_COLUMNS = "schedule_day, version, status, cards_done_at, unlocked_at";
const PROOF_COLUMNS = "id, schedule_day, file_path, file_name, link_url, status, review_note, created_at";
// What the VA's browser may see of a scenario.
const DISPLAY_COLUMNS = "id, type, points, answer_format, stem, options, workflow, part_title, code";

type DisplayScenario = {
  id: string;
  type: "mc" | "situational" | "describe";
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

  const [office, days, settings, unlocks, proofs, scenarios, officeDays, me] = await Promise.all([
    db
      .from("offices")
      .select("name, bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool")
      .eq("id", officeId)
      .maybeSingle(),
    db.from("schedule_days").select(DAY_COLUMNS),
    db.from("settings").select("key, value").in("key", ["conditions", "sequence"]),
    db.from("day_unlocks").select(UNLOCK_COLUMNS).eq("va_id", user.id).eq("office_id", officeId),
    db.from("proof_uploads").select(PROOF_COLUMNS).eq("va_id", user.id).eq("office_id", officeId).order("created_at"),
    db
      .from("office_scenarios")
      .select("schedule_day, test_status")
      .eq("office_id", officeId)
      .eq("version", "A")
      .eq("is_repeat_variant", false),
    db.from("office_days").select("schedule_day, live_version").eq("office_id", officeId).not("live_version", "is", null),
    db.from("profiles").select("va_scope").eq("id", user.id).maybeSingle(),
  ]);
  const officeRow = must(office);
  if (!officeRow) return { kind: "no_office" as const };
  const settingRows = must(settings) ?? [];
  const scenarioRows = must(scenarios) ?? [];

  // A day is approved once VFDA has approved a version of it: the live version,
  // which new attempts get.
  const liveVersions = new Map(((must(officeDays) ?? []) as { schedule_day: string; live_version: number }[]).map((d) => [d.schedule_day, d.live_version]));
  const approved = new Set(liveVersions.keys());

  const unlockRows = (must(unlocks) ?? []) as UnlockRow[];
  const pathInput = {
    sequence: (settingValue(settingRows, "sequence") as string[] | undefined) ?? [],
    days: (must(days) ?? []) as DayRow[],
    conditions: (settingValue(settingRows, "conditions") as Record<string, string> | undefined) ?? {},
    profile: officeProfile(officeRow),
    officeScenarioDays: new Set(scenarioRows.map((s) => s.schedule_day)),
  };
  // Only the VA's roles; a day they already opened stays.
  const scope = normalizeScope(must(me)?.va_scope);
  const path = trainingPath({
    ...pathInput,
    scope,
    started: new Set(unlockRows.filter((u) => u.status !== "locked").map((u) => u.schedule_day)),
  });
  const proofRows = (must(proofs) ?? []) as ProofRow[];
  const today = buildToday({ path, unlocks: unlockRows, approved });

  // Open the day (once).
  if (today.kind === "open" && today.current.status !== "open") {
    const { data: opened, error } = await db
      .from("day_unlocks")
      .update({ status: "open", unlocked_at: new Date().toISOString() })
      .eq("va_id", user.id)
      .eq("office_id", officeId)
      .eq("schedule_day", today.current.day.code)
      .eq("status", "locked")
      .select("status");
    if (error) throw new Error(error.message);
    if (opened?.length) today.current.status = "open";
  }

  return { kind: "ok" as const, officeName: officeRow.name as string, today, proofs: proofRows, liveVersions };
}

// "Mark today's cards done" for the next day. Opens it at once when VFDA has
// approved it; otherwise VFDA is told (once) that the VA is waiting.
export async function markCardsDone(user: CurrentUser): Promise<{ error: string | null; preparing: string | null }> {
  const loaded = await loadToday(user);
  if (loaded.kind !== "ok") return { error: "Your account isn't linked to an office yet.", preparing: null };
  const { today } = loaded;
  if (today.kind === "open") return { error: null, preparing: null };
  if (today.kind === "preparing") return { error: null, preparing: today.current.day.code };
  if (today.kind !== "cards") return { error: "There's no day waiting for its cards.", preparing: null };
  const day = today.current;

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = day.unlock
    ? await db
        .from("day_unlocks")
        .update({ cards_done_at: now })
        .eq("va_id", user.id)
        .eq("office_id", user.officeId)
        .eq("schedule_day", day.day.code)
        .is("cards_done_at", null)
    : await db
        .from("day_unlocks")
        .upsert(
          { va_id: user.id, office_id: user.officeId, schedule_day: day.day.code, version: "A", status: "locked", cards_done_at: now },
          { onConflict: "va_id,office_id,schedule_day", ignoreDuplicates: true },
        );
  if (error) return { error: "Couldn't save. Try again.", preparing: null };
  // Opens the day now if VFDA approved it.
  const after = await loadToday(user);
  const preparing = after.kind === "ok" && after.today.kind === "preparing" ? after.today.current.day.code : null;
  return { error: null, preparing };
}

// Claims the "VFDA has been notified" for a day the VA is waiting on.
// True only for the one request that should send it.
export async function claimPreparingNotice(user: CurrentUser, day: string): Promise<boolean> {
  if (!user.officeId) return false;
  const { data } = await createAdminClient()
    .from("day_unlocks")
    .update({ prep_notified_at: new Date().toISOString() })
    .eq("va_id", user.id)
    .eq("office_id", user.officeId)
    .eq("schedule_day", day)
    .eq("status", "locked")
    .is("prep_notified_at", null)
    .select("id");
  return !!data?.length;
}

// ---------------------------------------------------------------------------
// The scenario screen
// ---------------------------------------------------------------------------

type DrillKind = "retrain" | "recheck" | "retake";

type DayContext = {
  db: Db;
  user: CurrentUser & { officeId: string };
  current: DayView;
  // A workflow recheck, or a day's retake, instead of a training day.
  drill: { id: string; kind: DrillKind; workflow: string } | null;
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
  // One attempt per day (archived ones, reset by VFDA for testing, don't count).
  const key = { va_id: user.id, office_id: officeId, schedule_day: current.day.code, version: "A", kind: "day" };
  const findAttempt = async () =>
    must(
      await db.from("attempts").select("id, started_at, submitted_at, build_version").match(key).is("archived_at", null).maybeSingle(),
    ) as (DayContext["attempt"] & { build_version: number | null }) | null;

  // The version the VA started on stays theirs, even after VFDA approves (or
  // reopens) a newer one. A new attempt gets the live version.
  let attemptRow = await findAttempt();
  if (!attemptRow) {
    const live = loaded.liveVersions.get(current.day.code);
    if (!live) return null;
    // Created on the first visit (a second request at the same time hits the unique index).
    const { error: insertError } = await db.from("attempts").insert({ ...key, build_version: live });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
    attemptRow = await findAttempt();
    if (!attemptRow) throw new Error("The attempt couldn't be started.");
  }
  const scenarios = await db
    .from("office_scenarios")
    .select(DISPLAY_COLUMNS)
    .eq("office_id", officeId)
    .eq("schedule_day", current.day.code)
    .eq("build_version", attemptRow.build_version ?? 1)
    .eq("version", "A")
    .eq("is_repeat_variant", false)
    .eq("test_status", "live")
    .order("position")
    .order("code");
  const items = must(await db.from("attempt_items").select(ITEM_COLUMNS).eq("attempt_id", attemptRow.id));
  return {
    db,
    user: { ...user, officeId },
    current,
    drill: null,
    attempt: attemptRow,
    scenarios: (must(scenarios) ?? []) as DisplayScenario[],
    items: (items ?? []) as DayContext["items"],
  };
}

// A retrain or recheck of one workflow, or a day's retake: its items were set
// when it was assigned (or prepared).
async function openDrill(user: CurrentUser, attemptId: string): Promise<DayContext | null> {
  if (!user.officeId) return null;
  const db = createAdminClient();
  const { data: attempt } = await db
    .from("attempts")
    .select("id, started_at, submitted_at, kind, schedule_day, version, certification_id")
    .eq("id", attemptId)
    .eq("va_id", user.id)
    .eq("office_id", user.officeId ?? "")
    .neq("kind", "day")
    .maybeSingle();
  if (!attempt) return null;
  const [day, rows] = await Promise.all([
    db.from("schedule_days").select(DAY_COLUMNS).eq("code", attempt.schedule_day).single(),
    db.from("attempt_items").select(`${ITEM_COLUMNS}, position`).eq("attempt_id", attempt.id).order("position"),
  ]);
  const items = (must(rows) ?? []) as DayContext["items"];
  const scenarios = items.length
    ? ((must(
        await db
          .from("office_scenarios")
          .select(DISPLAY_COLUMNS)
          .eq("office_id", user.officeId)
          .in(
            "id",
            items.map((i) => i.office_scenario_id),
          ),
      ) ?? []) as DisplayScenario[])
    : [];
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const ordered = items.map((i) => byId.get(i.office_scenario_id)).filter((s): s is DisplayScenario => !!s);
  const kind = attempt.kind as DrillKind;
  const workflow = ordered[0]?.workflow ?? "";
  const dayRow = must(day) as DayRow;
  return {
    db,
    user: { ...user, officeId: user.officeId },
    current: {
      index: 0,
      day: { ...dayRow, title: kind === "retake" ? dayRow.title : workflow },
      unlock: null,
      status: "open",
      version: attempt.version as DayView["version"],
    },
    drill: { id: attempt.id, kind, workflow },
    attempt: { id: attempt.id, started_at: attempt.started_at, submitted_at: attempt.submitted_at },
    scenarios: ordered,
    items,
  };
}

const DRILL_LABELS: Record<DrillKind, (day: string) => string> = {
  retrain: () => "Retrain",
  recheck: () => "Recheck",
  retake: (day) => `Retake ${day}`,
};

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
    dayCode: ctx.drill ? DRILL_LABELS[ctx.drill.kind](ctx.current.day.code) : ctx.current.day.code,
    dayTitle: ctx.current.day.title,
    workflow: shown.workflow,
    partTitle: shown.part_title,
    type: shown.type,
    format: formatOf(shown.type, shown.answer_format, ctx.current.day.answer_format),
    stem: shown.stem,
    options,
    priorFeedback,
    drillId: ctx.drill?.id ?? null,
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
  return ctx ? screenFor(ctx) : { kind: "closed" };
}

export async function loadDrillScreen(user: CurrentUser, attemptId: string): Promise<DayScreen> {
  const ctx = await openDrill(user, attemptId);
  return ctx ? screenFor(ctx) : { kind: "closed" };
}

async function screenFor(ctx: DayContext): Promise<DayScreen> {
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
    } else {
      // A drill's items exist from the start; its time runs from when one is first shown.
      const row = ctx.items.find((i) => i.office_scenario_id === next.scenario.id);
      if (row && !row.served_at) {
        await ctx.db.from("attempt_items").update({ served_at: new Date().toISOString() }).eq("id", row.id).is("served_at", null);
      }
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
export async function officeRulesFor(db: Db, officeId: string, workflow: string) {
  const slots = must(await db.from("rule_slots").select("key").contains("workflows", [workflow])) ?? [];
  if (!slots.length) return [];
  const rows =
    must(
      await db
        .from("office_rules")
        .select("rule_slot_key, rule, source_document_id, source")
        .eq("office_id", officeId)
        .eq("status", "accepted")
        .in(
          "rule_slot_key",
          slots.map((s) => s.key),
        ),
    ) ?? [];
  // A direct answer (doctor or VFDA) wins over the doctor's VA Office Rules
  // card, and that over another card's version.
  const rank = (r: { source_document_id: string | null; source: string }) =>
    !r.source_document_id ? 0 : r.source === "doctor_card" ? 1 : 2;
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
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
  drillId: string | null = null,
): Promise<{ ok: true; data: SubmitOutcome; critical?: { itemId: string; phase: "first" | "repeat" } } | { ok: false; error: string }> {
  const ctx = drillId ? await openDrill(user, drillId) : await openDay(user);
  if (!ctx || ctx.attempt.submitted_at) return { ok: false, error: "Nothing is open for you here right now." };
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

  // Situational and describe: the boxes for this answer format.
  const format: AnswerFormat = formatOf(key.type, key.answer_format as AnswerFormat | null, ctx.current.day.answer_format);
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
    kind: key.type === "describe" ? "describe" : "situational",
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

  // Below 2/2 on the first try: the repeat variant comes right away (situational only).
  // A retake item's repeat was written with it (a drill variant too).
  let repeat: DisplayScenario | null = null;
  if (phase === "first" && grade && grade.score < 2 && key.type === "situational") {
    const { data } = await ctx.db
      .from("office_scenarios")
      .select(DISPLAY_COLUMNS)
      .eq("parent_scenario_id", scenarioId)
      .eq("is_repeat_variant", true)
      .eq("recheck", ctx.drill?.kind === "retake")
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
  const confidence = grade ? CONFIDENCE_VALUE[grade.confidence] : null;
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
  // A critical error alerts VFDA and the doctor at once (the VA keeps going).
  const critical = grade?.critical_error ? { itemId: item.id, phase } : undefined;

  if (!repeat) return { ok: true, data: { feedback, repeat: null }, critical };
  const parent = ctx.scenarios.find((s) => s.id === scenarioId)!;
  return { ok: true, data: { feedback, repeat: toServed(ctx, parent, repeat, "repeat", feedback) }, critical };
}

// ---------------------------------------------------------------------------
// End of the day
// ---------------------------------------------------------------------------

export type FinishedDay = {
  attemptId: string;
  drill: DrillKind | null;
  // True only for the request that worked the result out (it sends the report).
  fresh: boolean;
  dayCode: string;
  result: ResultLabel | null;
  points: number;
  max: number;
};

async function finishDay(ctx: DayContext): Promise<FinishedDay> {
  const { db, current, attempt } = ctx;
  const now = new Date();
  const base = {
    attemptId: attempt.id,
    drill: ctx.drill?.kind ?? null,
    dayCode: ctx.drill && ctx.drill.kind !== "retake" ? current.day.title : current.day.code,
  };

  // Claim the finish, so it is worked out once.
  const { data: claimed } = await db
    .from("attempts")
    .update({ submitted_at: now.toISOString() })
    .eq("id", attempt.id)
    .is("submitted_at", null)
    .select("id");
  if (!claimed?.length) {
    const { data } = await db.from("attempts").select("result, first_try_points, max_points").eq("id", attempt.id).single();
    return {
      ...base,
      fresh: false,
      result: (data?.result as ResultLabel | null) ?? null,
      points: Number(data?.first_try_points ?? 0),
      max: data?.max_points ?? 0,
    };
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
      // The VA sees their score and feedback right away.
      feedback_released_at: now.toISOString(),
    })
    .eq("id", attempt.id);

  // The day is done whatever the score; the next one can open.
  if (!ctx.drill) {
    await db
      .from("day_unlocks")
      .update({ status: "done" })
      .eq("va_id", ctx.user.id)
      .eq("office_id", ctx.user.officeId)
      .eq("schedule_day", current.day.code)
      .eq("status", "open");
  }

  await recalculateCertifications(ctx.user.id);
  return { ...base, fresh: true, result: outcome.result, points: outcome.points, max: outcome.max };
}

// ---------------------------------------------------------------------------
// One optional retake of a whole day (Needs coaching or At risk). Never
// blocks the next day; the first try stays the official score.
// ---------------------------------------------------------------------------

const RETAKE_LABELS: ResultLabel[] = ["needs_coaching", "at_risk"];
// A retake still without items this long after it was claimed: its
// preparation died, and it may be started again.
const STALE_RETAKE_MS = 10 * 60 * 1000;

export type RetakeTask =
  | { kind: "available"; parentId: string; day: string; title: string; result: ResultLabel }
  | { kind: "open"; id: string; parentId: string; day: string; title: string };

type RetakeRow = { id: string; parent_attempt_id: string; created_at: string; submitted_at: string | null };

// Retakes with their items written (the others are still being prepared, or died).
async function preparedRetakes(db: Db, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = (must(await db.from("attempt_items").select("attempt_id").in("attempt_id", ids)) ?? []) as { attempt_id: string }[];
  return new Set(rows.map((r) => r.attempt_id));
}

// The VA's retakes: days they may still retake, and retakes started but not finished.
export async function loadRetakeTasks(vaId: string, officeId: string): Promise<RetakeTask[]> {
  const db = createAdminClient();
  const [daysRes, retakesRes, titlesRes] = await Promise.all([
    db
      .from("attempts")
      .select("id, schedule_day, result, submitted_at")
      .eq("va_id", vaId)
      .eq("office_id", officeId)
      .eq("kind", "day")
      .is("archived_at", null)
      .not("submitted_at", "is", null)
      .in("result", RETAKE_LABELS)
      .order("submitted_at"),
    db
      .from("attempts")
      .select("id, parent_attempt_id, created_at, submitted_at")
      .eq("va_id", vaId)
      .eq("office_id", officeId)
      .eq("kind", "retake")
      .is("archived_at", null),
    db.from("schedule_days").select("code, title"),
  ]);
  const titles = new Map(((must(titlesRes) ?? []) as { code: string; title: string }[]).map((d) => [d.code, d.title]));
  const retakes = (must(retakesRes) ?? []) as RetakeRow[];
  const prepared = await preparedRetakes(db, retakes.map((r) => r.id));
  const tasks: RetakeTask[] = [];
  for (const d of (must(daysRes) ?? []) as { id: string; schedule_day: string; result: ResultLabel }[]) {
    const retake = retakes.find((r) => r.parent_attempt_id === d.id);
    const title = titles.get(d.schedule_day) ?? "";
    if (!retake || !prepared.has(retake.id)) {
      tasks.push({ kind: "available", parentId: d.id, day: d.schedule_day, title, result: d.result });
    } else if (!retake.submitted_at) {
      tasks.push({ kind: "open", id: retake.id, parentId: d.id, day: d.schedule_day, title });
    }
  }
  return tasks;
}

type ScenarioCopy = Record<string, unknown> & {
  id: string;
  code: string;
  type: "mc" | "situational" | "describe";
  stem: string;
  options: unknown;
  answer: string | null;
  correct_response: unknown;
  critical_fail: string | null;
  workflow: string;
};

// The office's rules for every workflow in the day, for the writer.
async function officeRulesForAll(db: Db, officeId: string, workflows: string[]) {
  const seen = new Map<string, string>();
  for (const w of workflows) for (const r of await officeRulesFor(db, officeId, w)) if (!seen.has(r.key)) seen.set(r.key, r.value);
  return [...seen].map(([key, value]) => ({ key, value }));
}

// "Retake this day": writes every item of the day again as a new version
// (same correct answer, new details; situational items with their repeat)
// and opens the retake. Takes a minute while Claude writes.
export async function startRetake(user: CurrentUser, parentId: string): Promise<{ id: string } | { error: string }> {
  if (!user.officeId) return { error: "Your account isn't linked to an office yet." };
  const officeId = user.officeId;
  const db = createAdminClient();
  const parent = must(
    await db
      .from("attempts")
      .select("id, schedule_day, kind, submitted_at, result, archived_at, build_version")
      .eq("id", parentId)
      .eq("va_id", user.id)
      .eq("office_id", officeId)
      .maybeSingle(),
  ) as {
    id: string;
    schedule_day: string;
    kind: string;
    submitted_at: string | null;
    result: string | null;
    archived_at: string | null;
    build_version: number | null;
  } | null;
  if (!parent || parent.kind !== "day" || !parent.submitted_at || parent.archived_at) return { error: "There's no finished day to retake here." };
  if (!RETAKE_LABELS.includes(parent.result as ResultLabel)) return { error: "Only a day labeled Needs coaching or At risk can be retaken." };

  // Once per day. A retake whose preparation died is started again.
  const existing = must(
    await db
      .from("attempts")
      .select("id, parent_attempt_id, created_at, submitted_at")
      .eq("parent_attempt_id", parent.id)
      .eq("kind", "retake")
      .is("archived_at", null)
      .maybeSingle(),
  ) as RetakeRow | null;
  if (existing) {
    if ((await preparedRetakes(db, [existing.id])).has(existing.id)) return existing.submitted_at ? { error: "You've already retaken this day." } : { id: existing.id };
    if (Date.now() - Date.parse(existing.created_at) < STALE_RETAKE_MS) return { error: "Your retake is being prepared. Try again in a minute." };
    must(await db.from("attempts").delete().eq("id", existing.id));
  }
  const { data: claimed, error: claimError } = await db
    .from("attempts")
    .insert({
      va_id: user.id,
      office_id: officeId,
      schedule_day: parent.schedule_day,
      version: "B",
      kind: "retake",
      is_retake: true,
      parent_attempt_id: parent.id,
      build_version: parent.build_version,
    })
    .select("id")
    .single();
  if (claimError?.code === "23505") return { error: "Your retake is being prepared. Try again in a minute." };
  if (claimError || !claimed) throw new Error(claimError?.message ?? "The retake couldn't be started.");
  const retakeId = (claimed as { id: string }).id;
  const written: string[] = [];

  try {
    const items = (must(
      await db.from("attempt_items").select("office_scenario_id, position").eq("attempt_id", parent.id).order("position"),
    ) ?? []) as { office_scenario_id: string; position: number }[];
    if (!items.length) throw new Error("the day has no items");
    const ids = items.map((i) => i.office_scenario_id);
    const [originalsRes, repeatsRes] = await Promise.all([
      db.from("office_scenarios").select("*").in("id", ids).eq("office_id", officeId),
      db
        .from("office_scenarios")
        .select("parent_scenario_id, stem")
        .in("parent_scenario_id", ids)
        .eq("is_repeat_variant", true)
        .eq("recheck", false),
    ]);
    const byId = new Map(((must(originalsRes) ?? []) as ScenarioCopy[]).map((o) => [o.id, o]));
    const repeats = (must(repeatsRes) ?? []) as { parent_scenario_id: string; stem: string }[];
    const originals = ids.map((id) => byId.get(id)).filter((o): o is ScenarioCopy => !!o);
    const key = (n: number) => `R${n + 1}`;

    const variants = await writeRetakeVariants(
      originals.map((o, n) => ({
        key: key(n),
        type: o.type,
        stem: o.stem,
        options: Array.isArray(o.options) ? (o.options as unknown[]).map(String) : null,
        answer: o.answer,
        correct_response: o.correct_response,
        critical_fail: o.critical_fail,
        seen: [o.stem, ...repeats.filter((r) => r.parent_scenario_id === o.id).map((r) => r.stem)],
        wantsRepeat: o.type === "situational",
      })),
      await officeRulesForAll(db, officeId, [...new Set(originals.map((o) => o.workflow))]),
    );

    // Drill variants (recheck = true) of the day's items: never served as a day's repeat.
    const copy = (o: ScenarioCopy, fields: Record<string, unknown>) => {
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = o;
      void _id;
      void _c;
      void _u;
      return {
        ...rest,
        id: crypto.randomUUID(),
        is_repeat_variant: true,
        recheck: true,
        test_status: "live",
        edited_by_vfda: false,
        review_error: null,
        ...fields,
      };
    };
    const retakeRows = originals.map((o, n) => {
      const v = variants.get(key(n));
      if (!v?.stem) throw new Error(`no new version of ${o.code}`);
      return copy(o, { stem: v.stem, parent_scenario_id: o.id });
    });
    const repeatRows = originals.flatMap((o, n) => {
      const stem = variants.get(key(n))?.repeat_stem;
      return stem ? [copy(o, { stem, options: null, answer: null, parent_scenario_id: retakeRows[n].id })] : [];
    });
    must(await db.from("office_scenarios").insert(retakeRows));
    written.push(...retakeRows.map((r) => r.id));
    if (repeatRows.length) must(await db.from("office_scenarios").insert(repeatRows));
    must(
      await db
        .from("attempt_items")
        .insert(retakeRows.map((r, position) => ({ attempt_id: retakeId, office_scenario_id: r.id, position }))),
    );
    // Time runs from now, not from when Claude started writing.
    must(await db.from("attempts").update({ started_at: new Date().toISOString() }).eq("id", retakeId));
    return { id: retakeId };
  } catch (e) {
    console.error("Retake not prepared", parent.id, e);
    await db.from("attempts").delete().eq("id", retakeId);
    // Their repeats go with them (on delete cascade).
    if (written.length) await db.from("office_scenarios").delete().in("id", written);
    return { error: `Couldn't prepare your retake: ${aiErrorMessage(e).slice(0, 160)}. Try again.` };
  }
}

// ---------------------------------------------------------------------------
// A new VA's suggested start date (Invite VA).
// ---------------------------------------------------------------------------

export function nextTrainingDay() {
  return addTrainingDays(todayIn(TIME_ZONE), 1);
}

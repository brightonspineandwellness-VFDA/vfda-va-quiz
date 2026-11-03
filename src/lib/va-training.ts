import "server-only";

// VA training on the server: loads the VA's days, opens the next one once the
// day before it was submitted, its cards are marked done and VFDA approved it
// for the office, serves scenarios one at a time, grades answers and labels
// the day. Quizzes never block. Uses the service role, so every function here
// checks the VA itself and returns only what the VA may see: never answer,
// correct_response, critical_fail or options_rule.

import { CONFIDENCE_VALUE, gradeSituational } from "@/lib/ai";
import type { CurrentUser } from "@/lib/auth";
import { recalculateCertifications } from "@/lib/certifications";
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

  const [office, days, settings, unlocks, proofs, scenarios] = await Promise.all([
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
  ]);
  const officeRow = must(office);
  if (!officeRow) return { kind: "no_office" as const };
  const settingRows = must(settings) ?? [];
  const scenarioRows = must(scenarios) ?? [];

  // A day is approved once VFDA has set all its scenarios live.
  const byDay = new Map<string, string[]>();
  for (const s of scenarioRows) byDay.set(s.schedule_day, [...(byDay.get(s.schedule_day) ?? []), s.test_status]);
  const approved = new Set([...byDay].filter(([, st]) => st.every((x) => x === "live")).map(([k]) => k));

  const path = trainingPath({
    sequence: (settingValue(settingRows, "sequence") as string[] | undefined) ?? [],
    days: (must(days) ?? []) as DayRow[],
    conditions: (settingValue(settingRows, "conditions") as Record<string, string> | undefined) ?? {},
    profile: officeProfile(officeRow),
    officeScenarioDays: new Set(scenarioRows.map((s) => s.schedule_day)),
  });
  const proofRows = (must(proofs) ?? []) as ProofRow[];
  const today = buildToday({ path, unlocks: (must(unlocks) ?? []) as UnlockRow[], approved });

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

  return { kind: "ok" as const, officeName: officeRow.name as string, today, proofs: proofRows };
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

type DayContext = {
  db: Db;
  user: CurrentUser & { officeId: string };
  current: DayView;
  // A workflow recheck instead of a training day.
  drill: { id: string; kind: "retrain" | "recheck"; workflow: string } | null;
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
  // One attempt per day.
  const key = { va_id: user.id, office_id: officeId, schedule_day: current.day.code, version: "A", kind: "day" };

  // Created on the first visit (a second request at the same time hits the unique index).
  const { error: insertError } = await db.from("attempts").insert(key);
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
  const [attempt, scenarios] = await Promise.all([
    db.from("attempts").select("id, started_at, submitted_at").match(key).single(),
    db
      .from("office_scenarios")
      .select(DISPLAY_COLUMNS)
      .eq("office_id", officeId)
      .eq("schedule_day", current.day.code)
      .eq("version", "A")
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
    drill: null,
    attempt: attemptRow,
    scenarios: (must(scenarios) ?? []) as DisplayScenario[],
    items: (items ?? []) as DayContext["items"],
  };
}

// A retrain or recheck of one workflow: its items were set when it was assigned.
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
  const kind = attempt.kind as "retrain" | "recheck";
  const workflow = ordered[0]?.workflow ?? "";
  return {
    db,
    user: { ...user, officeId: user.officeId },
    current: {
      index: 0,
      day: { ...(must(day) as DayRow), title: workflow },
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
    dayCode: ctx.drill ? (ctx.drill.kind === "retrain" ? "Retrain" : "Recheck") : ctx.current.day.code,
    dayTitle: ctx.current.day.title,
    workflow: shown.workflow,
    partTitle: shown.part_title,
    type: shown.type,
    format: shown.answer_format ?? ctx.current.day.answer_format,
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
      .eq("recheck", false)
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
  drill: "retrain" | "recheck" | null;
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
    dayCode: ctx.drill ? current.day.title : current.day.code,
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
// A new VA's suggested start date (Invite VA).
// ---------------------------------------------------------------------------

export function nextTrainingDay() {
  return addTrainingDays(todayIn(TIME_ZONE), 1);
}

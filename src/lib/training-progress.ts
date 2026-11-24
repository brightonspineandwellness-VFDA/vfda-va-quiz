import "server-only";

// Where a VA is in their quiz training: their scheduled days (the same path
// Today uses, src/lib/va-flow.ts trainingPath) and which of them were
// submitted. Used for "Day X of Y completed" on reports, the weekly summary
// (src/lib/weekly.ts) and when the training program may be built
// (src/lib/training-program.ts).

import { createAdminClient } from "@/lib/supabase/server";
import { officeProfile, trainingPath, type DayRow, type OfficeFlags } from "@/lib/va-flow";
import { normalizeScope } from "@/lib/va-scope";

type Db = ReturnType<typeof createAdminClient>;

const DAY_COLUMNS = "code, week, day, title, cards, condition, max_points, pass_points, review_min_points, answer_format, proof_of_work";

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export type DayAttempt = {
  id: string;
  schedule_day: string;
  kind: string;
  parent_attempt_id: string | null;
  submitted_at: string;
  result: string | null;
  first_try_points: number | null;
  max_points: number | null;
  critical_errors: number;
};

export type VaPath = {
  path: DayRow[];
  // Every finished attempt of the VA at this office (days, retakes, drills), oldest first.
  attempts: DayAttempt[];
  // Each scheduled day's first finished day attempt.
  firstTry: Map<string, DayAttempt>;
};

// The VA's scheduled days and finished attempts. Archived (test) attempts don't count.
export async function loadVaPath(db: Db, vaId: string, officeId: string): Promise<VaPath> {
  const [office, days, settings, scenarios, unlocks, me, attempts] = await Promise.all([
    db.from("offices").select("bills_insurance, billing_type, has_reexam_card, has_gray_cards, remote_access_tool").eq("id", officeId).maybeSingle(),
    db.from("schedule_days").select(DAY_COLUMNS),
    db.from("settings").select("key, value").in("key", ["conditions", "sequence"]),
    // Every built day ("*": title only exists once practice-days.sql has been run).
    db.from("office_days").select("*").eq("office_id", officeId),
    db.from("day_unlocks").select("schedule_day, status").eq("va_id", vaId).eq("office_id", officeId),
    db.from("profiles").select("va_scope").eq("id", vaId).maybeSingle(),
    db
      .from("attempts")
      .select("id, schedule_day, kind, parent_attempt_id, submitted_at, result, first_try_points, max_points, critical_errors")
      .eq("va_id", vaId)
      .eq("office_id", officeId)
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at"),
  ]);
  const officeRow = must(office) as OfficeFlags | null;
  const settingRows = (must(settings) ?? []) as { key: string; value: unknown }[];
  const setting = (key: string) => settingRows.find((s) => s.key === key)?.value;
  const unlockRows = (must(unlocks) ?? []) as { schedule_day: string; status: string }[];
  const path = officeRow
    ? trainingPath({
        sequence: (setting("sequence") as string[] | undefined) ?? [],
        days: (must(days) ?? []) as DayRow[],
        conditions: (setting("conditions") as Record<string, string> | undefined) ?? {},
        profile: officeProfile(officeRow),
        officeScenarioDays: new Set(((must(scenarios) ?? []) as { schedule_day: string; build_version: number | null }[]).filter((s) => s.build_version).map((s) => s.schedule_day)),
        officeDays: new Map(((must(scenarios) ?? []) as { schedule_day: string; kind: string | null; title?: string | null }[]).map((s) => [s.schedule_day, s])),
        scope: normalizeScope(must(me)?.va_scope),
        started: new Set(unlockRows.filter((u) => u.status !== "locked").map((u) => u.schedule_day)),
      })
    : [];
  const list = ((must(attempts) ?? []) as DayAttempt[]).map((a) => ({ ...a, critical_errors: a.critical_errors ?? 0 }));
  const firstTry = new Map<string, DayAttempt>();
  for (const a of list) if (a.kind === "day" && !firstTry.has(a.schedule_day)) firstTry.set(a.schedule_day, a);
  return { path, attempts: list, firstTry };
}

// "Day X of Y completed": the scheduled days submitted by `asOf` (an ISO time;
// default now), of all the VA's scheduled days.
export function progressOf(p: VaPath, asOf?: string): { done: number; total: number } {
  const done = p.path.filter((d) => {
    const a = p.firstTry.get(d.code);
    return !!a && (!asOf || a.submitted_at <= asOf);
  }).length;
  return { done, total: p.path.length };
}

export async function dayProgress(db: Db, vaId: string, officeId: string, asOf?: string) {
  try {
    return progressOf(await loadVaPath(db, vaId, officeId), asOf);
  } catch (e) {
    console.error("Training progress not loaded", vaId, e instanceof Error ? e.message : e);
    return null;
  }
}

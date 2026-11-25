import "server-only";

// Call practice progress for one or more VAs. Counting rules:
//   - every FINISHED call counts toward 25, passed or not;
//   - W2D1 roleplays count as easy, W2D2 roleplays as challenging;
//   - a VFDA override replaces the call's result everywhere;
//   - the pass rate is passed / finished-and-graded, per bucket.

import { createAdminClient } from "@/lib/supabase/server";
import { goalBucket, ROLEPLAYS, type CallType, type Roleplay } from "./types";

type Db = ReturnType<typeof createAdminClient>;

export const GOAL = 25;

export type CallSummaryRow = {
  id: string;
  va_id: string;
  office_id: string;
  call_type: CallType;
  roleplay: Roleplay | null;
  status: "in_progress" | "finished" | "abandoned";
  result: "passed" | "practice_again" | null;
  override_result: "passed" | "practice_again" | null;
  flags: unknown[];
  started_at: string;
  finished_at: string | null;
};

export const SUMMARY_COLUMNS = "id, va_id, office_id, call_type, roleplay, status, result, override_result, flags, started_at, finished_at";

export const effectiveResult = (c: Pick<CallSummaryRow, "result" | "override_result">) => c.override_result ?? c.result;

export type Bucket = { finished: number; graded: number; passed: number; passRate: number | null };
export type VaCallProgress = {
  easy: Bucket;
  challenging: Bucket;
  roleplays: Record<Roleplay, boolean>; // passed at least once
  w2d1Passed: number; // of 3
  w2d2Passed: number; // of 3
  flagged: number;
  lastCallAt: string | null;
};

const emptyBucket = (): Bucket => ({ finished: 0, graded: 0, passed: 0, passRate: null });

export function summarize(calls: CallSummaryRow[]): VaCallProgress {
  const easy = emptyBucket();
  const challenging = emptyBucket();
  const roleplays = Object.fromEntries(
    [...ROLEPLAYS.w2d1_roleplay, ...ROLEPLAYS.w2d2_roleplay].map((r) => [r, false]),
  ) as Record<Roleplay, boolean>;
  let flagged = 0;
  let lastCallAt: string | null = null;
  for (const c of calls) {
    if (c.status !== "finished") continue;
    const b = goalBucket(c.call_type) === "easy" ? easy : challenging;
    b.finished++;
    const r = effectiveResult(c);
    if (r) b.graded++;
    if (r === "passed") {
      b.passed++;
      if (c.roleplay) roleplays[c.roleplay] = true;
    }
    if (Array.isArray(c.flags) && c.flags.length) flagged++;
    if (!lastCallAt || (c.finished_at ?? c.started_at) > lastCallAt) lastCallAt = c.finished_at ?? c.started_at;
  }
  for (const b of [easy, challenging]) b.passRate = b.graded ? Math.round((b.passed / b.graded) * 100) : null;
  return {
    easy,
    challenging,
    roleplays,
    w2d1Passed: ROLEPLAYS.w2d1_roleplay.filter((r) => roleplays[r]).length,
    w2d2Passed: ROLEPLAYS.w2d2_roleplay.filter((r) => roleplays[r]).length,
    flagged,
    lastCallAt,
  };
}

// Calls for these VAs (service role; callers check who may see them).
export async function loadCallsFor(db: Db, filter: { vaIds?: string[]; officeIds?: string[] }): Promise<CallSummaryRow[]> {
  let q = db.from("practice_calls").select(SUMMARY_COLUMNS).order("started_at", { ascending: false }).limit(5000);
  if (filter.vaIds) q = q.in("va_id", filter.vaIds.length ? filter.vaIds : ["00000000-0000-0000-0000-000000000000"]);
  if (filter.officeIds) q = q.in("office_id", filter.officeIds.length ? filter.officeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  // Table missing (migration not run yet) = no calls.
  if (error) return [];
  return (data ?? []) as CallSummaryRow[];
}

export const passRateText = (b: Bucket) => (b.passRate === null ? "no calls yet" : `${b.passRate}% passed`);

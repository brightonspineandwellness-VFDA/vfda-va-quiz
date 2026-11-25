import "server-only";

// The only link between Call practice and the quiz flow: once a VA has passed
// all three W2D1 roleplays (or all three W2D2 roleplays), a proof-of-work row
// is added for that day, pending, for VFDA to accept or ask for a redo as
// usual. Proof is shown and reviewed, never blocking (src/lib/va-flow.ts
// proofState), so no unlock rule changes. Existing proof rows are never
// edited or removed; at most one Call practice proof row is added per day.

import { appUrl } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { effectiveResult } from "./progress";
import { ROLEPLAYS, type Roleplay } from "./types";

type Db = ReturnType<typeof createAdminClient>;

const DAYS = [
  { day: "W2D1", type: "w2d1_roleplay", roleplays: ROLEPLAYS.w2d1_roleplay },
  { day: "W2D2", type: "w2d2_roleplay", roleplays: ROLEPLAYS.w2d2_roleplay },
] as const;

export const PROOF_NAME = (day: string) => `Call practice: all 3 ${day} roleplays passed`;

export async function syncRoleplayProof(db: Db, vaId: string, officeId: string): Promise<void> {
  const { data } = await db
    .from("practice_calls")
    .select("call_type, roleplay, result, override_result")
    .eq("va_id", vaId)
    .eq("office_id", officeId)
    .eq("status", "finished")
    .in("call_type", ["w2d1_roleplay", "w2d2_roleplay"]);
  const calls = (data ?? []) as { call_type: string; roleplay: Roleplay | null; result: "passed" | "practice_again" | null; override_result: "passed" | "practice_again" | null }[];

  for (const d of DAYS) {
    const passed = new Set(calls.filter((c) => c.call_type === d.type && effectiveResult(c) === "passed").map((c) => c.roleplay));
    if (!d.roleplays.every((r) => passed.has(r))) continue;
    const { data: existing } = await db
      .from("proof_uploads")
      .select("id")
      .eq("va_id", vaId)
      .eq("schedule_day", d.day)
      .eq("file_name", PROOF_NAME(d.day))
      .limit(1);
    if (existing?.length) continue;
    const { error } = await db.from("proof_uploads").insert({
      va_id: vaId,
      office_id: officeId,
      schedule_day: d.day,
      link_url: `${appUrl()}/admin/calls?va=${vaId}`,
      file_name: PROOF_NAME(d.day),
    });
    if (error) console.error(`Call practice proof for ${d.day} not added:`, error.message);
  }
}

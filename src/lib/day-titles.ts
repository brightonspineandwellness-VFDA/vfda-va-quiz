import "server-only";

// Day titles as an office sees them: a practice day standing in for a
// skipped W2D3 / W2D4 / W2D5 is "Phone practice 1: Everyday calls", not
// "Insurance" (src/lib/practice-days.ts).

import { officeDayTitle } from "@/lib/practice-days";
import type { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof import("@/lib/supabase/server").createSessionClient>>;

// code -> title at the office.
export async function officeDayTitles(db: Db, officeId: string | null): Promise<Map<string, string>> {
  const [days, built] = await Promise.all([
    db.from("schedule_days").select("code, title"),
    // "*": title only exists once practice-days.sql has been run.
    officeId ? db.from("office_days").select("*").eq("office_id", officeId) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const officeDays = new Map(
    ((built.data ?? []) as { schedule_day: string; kind: string | null; title?: string | null }[]).map((d) => [d.schedule_day, d]),
  );
  return new Map(
    ((days.data ?? []) as { code: string; title: string }[]).map((d) => [d.code, officeDayTitle(d.code, d.title, officeDays.get(d.code))]),
  );
}

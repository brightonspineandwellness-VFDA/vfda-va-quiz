import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient>;

export type OfficeTz = { id: string; name: string; time_zone: string | null };

// Offices with their time zone (null before weekly-summary.sql has been run).
export async function loadOfficesTz(db: Db, ids?: string[]): Promise<OfficeTz[]> {
  const q = (cols: string) => {
    const b = db.from("offices").select(cols);
    return ids ? b.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]) : b;
  };
  let res = await q("id, name, time_zone");
  if (res.error && /time_zone/.test(res.error.message)) res = await q("id, name");
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as unknown as Record<string, unknown>[]).map((o) => ({
    id: String(o.id),
    name: String(o.name),
    time_zone: (o.time_zone as string | null | undefined) ?? null,
  }));
}

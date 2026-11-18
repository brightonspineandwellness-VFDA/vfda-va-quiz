import { loadOfficesTz } from "@/lib/offices-tz";
import { createAdminClient } from "@/lib/supabase/server";
import { maybeBuildProgram } from "@/lib/training-program";
import { sendOfficePrograms } from "@/lib/training-send";
import { dueSunday, zoneOf } from "@/lib/week";
import { sendWeeklySummaries } from "@/lib/weekly";

// Sunday night (vercel.json "7 1 * * 1" UTC = Sunday 8:07 pm US Eastern):
// for every office whose Sunday night it is (its own time zone,
// src/lib/week.ts), the weekly summary of each VA in quiz training, then
// the training program sessions due (src/lib/training-send.ts). It also
// retries any training program whose build failed.
// Vercel sends CRON_SECRET as a bearer token; nothing else may run it.
// Every send is a notifications row, so a second run never sends twice.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  // The once-a-week run (Monday 01:xx UTC) is every US office's Sunday night.
  const weeklyCron = now.getUTCDay() === 1 && now.getUTCHours() < 3;
  const db = createAdminClient();
  const out: Record<string, unknown>[] = [];
  for (const office of await loadOfficesTz(db)) {
    const sunday = dueSunday(zoneOf(office.time_zone), now, weeklyCron);
    if (!sunday) continue;
    const weekly = await sendWeeklySummaries(db, office, sunday).catch((e: unknown) => {
      console.error("Weekly summaries failed", office.name, e);
      return { error: e instanceof Error ? e.message : String(e) };
    });
    // A program whose build failed (or never ran) is built now; it starts next Sunday.
    const { data: vas } = await db.from("profiles").select("id").eq("role", "va").eq("office_id", office.id).is("deactivated_at", null);
    for (const va of vas ?? []) await maybeBuildProgram(va.id, office.id).catch((e: unknown) => console.error("Training program retry failed", va.id, e));
    const programs = await sendOfficePrograms(db, office.id, sunday).catch((e: unknown) => {
      console.error("Training programs failed", office.name, e);
      return { error: e instanceof Error ? e.message : String(e) };
    });
    out.push({ office: office.name, sunday, weekly, programs });
  }
  return Response.json({ ran: now.toISOString(), offices: out });
}

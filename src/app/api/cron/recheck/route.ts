import { openDueRechecks } from "@/lib/certifications";
import { todayIn } from "@/lib/va-flow";

// Daily (vercel.json): opens a recheck for every certification past its
// recheck date. Vercel sends CRON_SECRET as a bearer token; nothing else may
// run it.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const today = todayIn(process.env.TRAINING_TIME_ZONE || "America/New_York");
  const result = await openDueRechecks(today);
  for (const e of result.errors) console.error("Recheck not opened:", e);
  return Response.json({ today, due: result.due, opened: result.opened.length, errors: result.errors.length });
}

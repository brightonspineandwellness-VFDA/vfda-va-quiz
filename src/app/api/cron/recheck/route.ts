import { openDueRechecks } from "@/lib/certifications";
import { runMorningEmails } from "@/lib/schedule-board";
import { todayIn } from "@/lib/va-flow";

// Once a day (vercel.json "0 13 * * *" = 8 am US Eastern standard time,
// 9 am in summer): opens a recheck for every certification past its recheck
// date, then sends the morning emails of the daily quiz schedule
// (src/lib/schedule-board.ts). Quizzes don't wait for this run: each one
// opens at 8 am office time on its own (src/lib/release-schedule.ts).
// Vercel sends CRON_SECRET as a bearer token; nothing else may run it.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const today = todayIn(process.env.TRAINING_TIME_ZONE || "America/New_York");
  const result = await openDueRechecks(today);
  for (const e of result.errors) console.error("Recheck not opened:", e);
  // An email failure never stops the rechecks (already done) from counting.
  const schedule = await runMorningEmails().catch((e: unknown) => {
    console.error("Morning emails failed:", e);
    return { error: e instanceof Error ? e.message : String(e) };
  });
  return Response.json({ today, due: result.due, opened: result.opened.length, errors: result.errors.length, schedule });
}

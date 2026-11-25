import { after } from "next/server";
import { finishCall } from "@/lib/call-practice/calls";
import { makeDueCallReports } from "@/lib/call-practice/report";
import { failed, requireVa } from "../../guard";

// End the call and write the feedback (Claude Opus 5.5). Safe to call again:
// a graded call returns its result; a failed grading is retried. Every 10th
// graded call also builds that VA's Call practice report, after the response.
export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/finish">) {
  const user = await requireVa();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const result = await finishCall(user, id);
  if ("error" in result) return failed(result);
  const officeId = user.officeId;
  if (officeId) {
    after(() =>
      makeDueCallReports(user.id, officeId).catch((e: unknown) => console.error("Call practice report failed:", e instanceof Error ? e.message : e)),
    );
  }
  return Response.json(result);
}

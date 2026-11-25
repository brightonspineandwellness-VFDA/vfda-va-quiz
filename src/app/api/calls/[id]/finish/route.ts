import { finishCall } from "@/lib/call-practice/calls";
import { failed, requireVa } from "../../guard";

// End the call and write the feedback (Claude Opus 5.5). Safe to call again:
// a graded call returns its result; a failed grading is retried.
export const maxDuration = 120;

export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/finish">) {
  const user = await requireVa();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const result = await finishCall(user, id);
  return "error" in result ? failed(result) : Response.json(result);
}

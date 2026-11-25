import { takeTurn } from "@/lib/call-practice/calls";
import { failed, requireVa } from "../../guard";

// One VA turn: { text } -> the patient's reply { say, endCall, index }.
export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/turn">) {
  const user = await requireVa();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const result = await takeTurn(user, id, body.text);
  return "error" in result ? failed(result) : Response.json(result);
}

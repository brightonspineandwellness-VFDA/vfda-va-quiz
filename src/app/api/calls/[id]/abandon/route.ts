import { abandonCall } from "@/lib/call-practice/calls";
import { failed, requireVa } from "../../guard";

// The VA left or hung up before finishing: the call is closed without feedback.
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/abandon">) {
  const user = await requireVa();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const result = await abandonCall(user, id);
  return "error" in result ? failed(result) : Response.json(result);
}

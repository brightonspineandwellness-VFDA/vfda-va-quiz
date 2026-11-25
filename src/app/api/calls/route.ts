import { startCall } from "@/lib/call-practice/calls";
import { failed, requireVa } from "./guard";

// Start a practice call: { callType, roleplay? } -> { id, persona, opening, left }
export async function POST(request: Request) {
  const user = await requireVa();
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => ({}))) as { callType?: unknown; roleplay?: unknown };
  const result = await startCall(user, { callType: body.callType, roleplay: body.roleplay });
  return "error" in result ? failed(result) : Response.json(result);
}

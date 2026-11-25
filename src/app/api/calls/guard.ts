import "server-only";

import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

// Call practice API routes aren't covered by proxy.ts's page redirects, so
// each one checks the signed-in user here first.
export async function requireVa(): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (user.role !== "va") return Response.json({ error: "Call practice is for VAs." }, { status: 403 });
  return user;
}

export const failed = (f: { error: string; status: number }) => Response.json({ error: f.error }, { status: f.status });

// A lighter check for the per-turn route: the signed-in user's id from the
// session's verified token (getClaims), without the profile lookup. The turn
// itself then checks the call belongs to this user.
export async function requireCaller(): Promise<{ id: string } | Response> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string") return Response.json({ error: "Please sign in again." }, { status: 401 });
  return { id: sub };
}

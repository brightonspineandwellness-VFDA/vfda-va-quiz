import "server-only";

import { getCurrentUser, type CurrentUser } from "@/lib/auth";

// Call practice API routes aren't covered by proxy.ts's page redirects, so
// each one checks the signed-in user here first.
export async function requireVa(): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (user.role !== "va") return Response.json({ error: "Call practice is for VAs." }, { status: 403 });
  return user;
}

export const failed = (f: { error: string; status: number }) => Response.json({ error: f.error }, { status: f.status });

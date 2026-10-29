import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { homeFor, isRole, type Role } from "@/lib/roles";
import { createSessionClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role | null;
  officeId: string | null;
};

// The signed-in user and their profile, or null. Verified with Supabase Auth
// (getUser), not just read from the cookie. Cached for one request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, office_id")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? "",
    role: isRole(profile?.role) ? profile.role : null,
    officeId: profile?.office_id ?? null,
  };
});

// Second line of defence behind proxy.ts: call at the top of every role page.
export async function requireRole(role: Role): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}

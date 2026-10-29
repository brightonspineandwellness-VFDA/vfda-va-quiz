import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

export default function VaPage() {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <VaHome />
      </Suspense>
    </SignedInPage>
  );
}

async function VaHome() {
  const user = await requireRole("va");
  const supabase = await createSessionClient();
  const [{ data: office }, { data: profile }] = await Promise.all([
    supabase.from("offices").select("name").maybeSingle(),
    supabase.from("profiles").select("va_start_date").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome, {user.fullName || user.email}</h1>
      <p>Office: {office?.name ?? "not found"}</p>
      <p>Training started: {profile?.va_start_date ?? "not set yet"}</p>
    </>
  );
}

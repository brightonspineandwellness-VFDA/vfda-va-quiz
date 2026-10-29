import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

export default function DoctorPage() {
  return (
    <SignedInPage area="Doctor">
      <Suspense fallback={<Loading />}>
        <DoctorHome />
      </Suspense>
    </SignedInPage>
  );
}

async function DoctorHome() {
  const user = await requireRole("doctor");
  const supabase = await createSessionClient();
  const { data: office } = await supabase.from("offices").select("name, status").maybeSingle();

  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome, {user.fullName || user.email}</h1>
      <p>Office: {office?.name ?? "not found"}</p>
      <Link href="/doctor/interview" className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background">
        Office setup
      </Link>
    </>
  );
}

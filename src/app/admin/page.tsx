import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

export default function AdminPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <AdminHome />
      </Suspense>
    </SignedInPage>
  );
}

async function AdminHome() {
  const user = await requireRole("vfda_admin");
  const supabase = await createSessionClient();
  const { count } = await supabase.from("offices").select("id", { count: "exact", head: true });

  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome, {user.fullName || user.email}</h1>
      <Link href="/admin/offices" className="self-start underline">
        Offices ({count ?? 0})
      </Link>
      <Link href="/admin/vas" className="self-start underline">
        VA training (progress, proof of work, reviews)
      </Link>
      <Link href="/admin/bank" className="self-start underline">
        Library
      </Link>
    </>
  );
}

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
  const [{ count }, { count: sops }] = await Promise.all([
    supabase.from("offices").select("id", { count: "exact", head: true }),
    supabase
      .from("certifications")
      .select("id", { count: "exact", head: true })
      .eq("sop_status", "pending")
      .not("sop_submitted_at", "is", null),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome, {user.fullName || user.email}</h1>
      <Link href="/admin/offices" className="self-start underline">
        Offices ({count ?? 0})
      </Link>
      <Link href="/admin/vas" className="self-start underline">
        VA progress (scores, flags, certifications, proof of work)
      </Link>
      <Link href="/admin/sops" className="self-start underline">
        SOPs to confirm ({sops ?? 0})
      </Link>
      <Link href="/admin/bank" className="self-start underline">
        Library
      </Link>
      <Link href="/admin/settings" className="self-start underline">
        Settings (grading mode, report test sends)
      </Link>
    </>
  );
}

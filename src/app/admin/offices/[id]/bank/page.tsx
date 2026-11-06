import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BankView } from "@/components/bank/bank-view";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { bankFilters } from "@/lib/bank-export";
import { loadBank } from "@/lib/scenario-bank";
import { createAdminClient } from "@/lib/supabase/server";

// "Regenerate" waits for Claude.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BankPage({ params, searchParams }: PageProps<"/admin/offices/[id]/bank">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <AdminBank params={params} searchParams={searchParams} />
      </Suspense>
    </SignedInPage>
  );
}

// Every built scenario for the office, with its answers. VFDA admins only.
async function AdminBank({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const bank = await loadBank(createAdminClient(), id);
  if (!bank) notFound();
  return (
    <>
      <Link href={`/admin/offices/${id}`} className="text-sm text-foreground/60 hover:underline">
        ← {bank.office.name}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Scenario bank: {bank.office.name}</h1>
        <p className="text-sm text-foreground/60">
          Every built scenario with its answers, by day and version. VFDA only; the office&apos;s doctors see it read-only
          when shared. VAs never see it.
        </p>
      </div>
      <BankView bank={bank} filters={bankFilters(await searchParams)} admin pagePath={`/admin/offices/${id}/bank`} exportPath={`/admin/offices/${id}/bank/export`} />
    </>
  );
}

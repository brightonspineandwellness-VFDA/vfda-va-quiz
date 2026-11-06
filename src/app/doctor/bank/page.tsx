import Link from "next/link";
import { Suspense } from "react";
import { BankView } from "@/components/bank/bank-view";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { bankFilters } from "@/lib/bank-export";
import { canReadBank, loadBank } from "@/lib/scenario-bank";
import { createAdminClient } from "@/lib/supabase/server";

export default function DoctorBankPage({ searchParams }: PageProps<"/doctor/bank">) {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor" className="text-sm text-foreground/60 hover:underline">
        ← Home
      </Link>
      <Suspense fallback={<Loading />}>
        <DoctorBank searchParams={searchParams} />
      </Suspense>
    </SignedInPage>
  );
}

// The office's scenario bank with answers, read-only, when VFDA shared it.
async function DoctorBank({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("doctor");
  if (!user.officeId || !(await canReadBank(user, user.officeId))) {
    return <p>VFDA hasn&apos;t shared your office&apos;s scenario bank with you.</p>;
  }
  const bank = await loadBank(createAdminClient(), user.officeId);
  if (!bank) return <p>Your office isn&apos;t set up yet.</p>;
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Scenario bank: {bank.office.name}</h1>
        <p className="text-sm text-foreground/60">Your VAs&apos; questions with the answers, shared by VFDA. Read-only; keep it away from your VAs.</p>
      </div>
      <BankView bank={bank} filters={bankFilters(await searchParams)} admin={false} pagePath="/doctor/bank" exportPath="/doctor/bank/export" />
    </>
  );
}

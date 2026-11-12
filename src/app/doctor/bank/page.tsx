import { EmptyState, Notice, PageHeader } from "@/components/ui";
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
    return <EmptyState title="Not shared yet">VFDA hasn&apos;t shared your office&apos;s scenario bank with you.</EmptyState>;
  }
  const bank = await loadBank(createAdminClient(), user.officeId);
  if (!bank) return <Notice tone="info" title="Your office isn't set up yet" />;
  return (
    <>
      <PageHeader
        title={`Scenario bank: ${bank.office.name}`}
        description="Your VAs' questions with the answers, shared by VFDA. Read-only; keep it away from your VAs."
        breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "Scenario bank" }]}
      />
      <BankView bank={bank} filters={bankFilters(await searchParams)} admin={false} pagePath="/doctor/bank" exportPath="/doctor/bank/export" />
    </>
  );
}

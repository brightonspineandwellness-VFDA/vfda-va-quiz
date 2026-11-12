import { Suspense } from "react";
import { Certificate } from "@/components/certs/certificate";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Breadcrumbs, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadCertGrid } from "@/lib/certifications";
import { createAdminClient } from "@/lib/supabase/server";

export default function VaCertificatePage() {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <Page />
      </Suspense>
    </SignedInPage>
  );
}

// The VA's own row only (read on the server; VAs can't read office scenarios).
async function Page() {
  const user = await requireRole("va");
  const { rows } = await loadCertGrid(createAdminClient(), { vaIds: [user.id] });
  const back = (
    <Breadcrumbs items={[{ label: "Today", href: "/va" }, { label: "My results", href: "/va/results" }, { label: "Certificate" }]} />
  );
  return rows[0] ? <Certificate row={rows[0]} back={back} /> : <EmptyState title="Not found">Your certificate shows up here once every workflow is certified.</EmptyState>;
}

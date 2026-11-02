import Link from "next/link";
import { Suspense } from "react";
import { Certificate } from "@/components/certs/certificate";
import { Loading, SignedInPage } from "@/components/signed-in-page";
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
    <Link href="/va/results" className="text-sm text-foreground/60 hover:underline">
      ← My results
    </Link>
  );
  return rows[0] ? <Certificate row={rows[0]} back={back} /> : <p>Not found.</p>;
}

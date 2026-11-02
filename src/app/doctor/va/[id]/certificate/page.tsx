import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Certificate } from "@/components/certs/certificate";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { loadCertGrid } from "@/lib/certifications";
import { createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DoctorCertificatePage({ params }: PageProps<"/doctor/va/[id]/certificate">) {
  return (
    <SignedInPage area="Doctor">
      <Suspense fallback={<Loading />}>
        <Page params={params} />
      </Suspense>
    </SignedInPage>
  );
}

// Own office's VAs only.
async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("doctor");
  const { id } = await params;
  if (!UUID.test(id) || !user.officeId) notFound();
  const { rows } = await loadCertGrid(await createSessionClient(), { vaIds: [id], officeId: user.officeId });
  if (!rows[0]) notFound();
  const back = (
    <Link href="/doctor/va" className="text-sm text-foreground/60 hover:underline">
      ← My VA
    </Link>
  );
  return <Certificate row={rows[0]} back={back} />;
}

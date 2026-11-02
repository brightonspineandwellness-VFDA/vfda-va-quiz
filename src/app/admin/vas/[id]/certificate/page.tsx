import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Certificate } from "@/components/certs/certificate";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { loadCertGrid } from "@/lib/certifications";
import { createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminCertificatePage({ params }: PageProps<"/admin/vas/[id]/certificate">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <Page params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { rows } = await loadCertGrid(await createSessionClient(), { vaIds: [id] });
  if (!rows[0]) notFound();
  const back = (
    <Link href="/admin/vas" className="text-sm text-foreground/60 hover:underline">
      ← VA progress
    </Link>
  );
  return <Certificate row={rows[0]} back={back} />;
}

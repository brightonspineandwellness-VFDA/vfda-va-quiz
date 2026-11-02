import Link from "next/link";
import { Suspense } from "react";
import { CertGrid } from "@/components/certs/cert-grid";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { loadCertGrid } from "@/lib/certifications";
import { createSessionClient } from "@/lib/supabase/server";

export default function MyVaPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor" className="text-sm text-foreground/60 hover:underline">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold">My VA</h1>
      <p className="text-sm text-foreground/70">
        Each workflow&apos;s status, with the Trello card your VA updated for it. Review and approve cards on Trello; VFDA records
        your approval here.
      </p>
      <Suspense fallback={<Loading />}>
        <Grid />
      </Suspense>
    </SignedInPage>
  );
}

// Read-only, own office only.
async function Grid() {
  const user = await requireRole("doctor");
  if (!user.officeId) return <p>Your account isn&apos;t linked to an office yet.</p>;
  const { columns, rows } = await loadCertGrid(await createSessionClient(), { officeId: user.officeId });
  return (
    <>
      <CertGrid columns={columns} rows={rows} certificatePath={(id) => `/doctor/va/${id}/certificate`} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-foreground/70">
        {columns.map((c) => (
          <div key={c.code} className="contents">
            <dt className="font-medium">{c.code}</dt>
            <dd>{c.name}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttemptReview } from "@/components/attempts/attempt-review";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadAttemptReview } from "@/lib/attempt-review";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

// "Resend" sends the report while you wait.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminAttemptPage({ params }: PageProps<"/admin/attempts/[id]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/vas" className="text-sm text-foreground/60 hover:underline">
        ← VA training
      </Link>
      <Suspense fallback={<Loading />}>
        <Attempt params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Attempt({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadAttemptReview(await createSessionClient(), id);
  if (!data) notFound();
  return <AttemptReview data={data} admin />;
}

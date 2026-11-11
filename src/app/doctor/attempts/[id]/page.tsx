import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttemptReview, RetakeReview } from "@/components/attempts/attempt-review";
import { VaTips } from "@/components/attempts/va-tips";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadAttemptWithRetake } from "@/lib/attempt-review";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read-only. Row-level security shows a doctor only their own office's VAs.
export default function DoctorAttemptPage({ params }: PageProps<"/doctor/attempts/[id]">) {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor" className="text-sm text-foreground/60 hover:underline">
        ← Home
      </Link>
      <Suspense fallback={<Loading />}>
        <Attempt params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Attempt({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("doctor");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadAttemptWithRetake(await createSessionClient(), id);
  if (!data) notFound();
  // A day with a retake: the original and the retake side by side.
  const ids = data.pair ? [data.pair.first.attempt.id, data.pair.retake.attempt.id] : [data.main.attempt.id];
  return (
    <>
      {data.pair ? <RetakeReview {...data.pair} admin={false} /> : <AttemptReview data={data.main} admin={false} />}
      {ids.map((attemptId) => (
        <VaTips key={attemptId} attemptId={attemptId} admin={false} />
      ))}
    </>
  );
}

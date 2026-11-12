import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttemptReview, RetakeReview } from "@/components/attempts/attempt-review";
import { VaTips } from "@/components/attempts/va-tips";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadAttemptWithRetake } from "@/lib/attempt-review";
import { requireRole } from "@/lib/auth";
import { attemptStandards } from "@/lib/quiz-reports";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

const CRUMBS = [{ label: "Home", href: "/doctor" }, { label: "My VA", href: "/doctor/va" }, { label: "Quiz report" }];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read-only. Row-level security shows a doctor only their own office's VAs.
export default function DoctorAttemptPage({ params }: PageProps<"/doctor/attempts/[id]">) {
  return (
    <SignedInPage area="Doctor">
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
  // The VFDA standards notice and the tips' tags. Loaded only after the
  // attempt itself was read with the user's own session (access checked).
  const db = createAdminClient();
  const loaded = await Promise.all(ids.map((attemptId) => attemptStandards(db, attemptId)));
  const standardsOf = Object.fromEntries(ids.map((attemptId, n) => [attemptId, loaded[n].standards]));
  return (
    <>
      {data.pair ? (
        <RetakeReview {...data.pair} admin={false} standards={standardsOf} breadcrumbs={CRUMBS} />
      ) : (
        <AttemptReview data={data.main} admin={false} standards={standardsOf[data.main.attempt.id]} breadcrumbs={CRUMBS} />
      )}
      {ids.map((attemptId, n) => (
        <VaTips key={attemptId} attemptId={attemptId} admin={false} items={loaded[n].needsWork} />
      ))}
    </>
  );
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttemptReview, RetakeReview } from "@/components/attempts/attempt-review";
import { VaTips } from "@/components/attempts/va-tips";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadAttemptWithRetake } from "@/lib/attempt-review";
import { requireRole } from "@/lib/auth";
import { attemptStandards } from "@/lib/quiz-reports";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

// "Resend" sends the report, and "Re-grade with new rubric" grades again, while you wait.
export const maxDuration = 300;

const CRUMBS = [{ label: "VA training", href: "/admin/vas" }, { label: "Attempt" }];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminAttemptPage({ params }: PageProps<"/admin/attempts/[id]">) {
  return (
    <SignedInPage area="VFDA admin">
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
        <RetakeReview {...data.pair} admin standards={standardsOf} breadcrumbs={CRUMBS} />
      ) : (
        <AttemptReview data={data.main} admin standards={standardsOf[data.main.attempt.id]} breadcrumbs={CRUMBS} />
      )}
      {ids.map((attemptId, n) => (
        <VaTips key={attemptId} attemptId={attemptId} admin={true} items={loaded[n].needsWork} />
      ))}
    </>
  );
}

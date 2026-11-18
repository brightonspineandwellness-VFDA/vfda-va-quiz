import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttemptReview, RetakeReview } from "@/components/attempts/attempt-review";
import { CompletedTiles, PracticeList, SkillChips } from "@/components/reports/skills";
import { Card, Notice } from "@/components/ui";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadAttemptWithRetake } from "@/lib/attempt-review";
import { requireRole } from "@/lib/auth";
import { attemptStandards } from "@/lib/quiz-reports";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import type { VaReportView } from "@/lib/va-report";
import { loadVaReportView } from "@/lib/va-reports";

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
  // The skills report (no scores): the same lists the VA sees.
  const views = await Promise.all(ids.map((attemptId) => loadVaReportView(db, attemptId)));
  return (
    <>
      {data.pair ? (
        <RetakeReview {...data.pair} admin={false} standards={standardsOf} breadcrumbs={CRUMBS} />
      ) : (
        <AttemptReview data={data.main} admin={false} standards={standardsOf[data.main.attempt.id]} breadcrumbs={CRUMBS} />
      )}
      {views.map((v) => v && <DoctorSkills key={v.attemptId} v={v} />)}
    </>
  );
}

// Status, label, progress, Skills [VA] showed, Skills to practice, Important to review.
function DoctorSkills({ v }: { v: VaReportView }) {
  const first = v.vaName.trim().split(/\s+/)[0] || "Your VA";
  return (
    <>
      <CompletedTiles resultLabel={v.resultLabel} progress={v.progress} progressCaption="Training progress" />
      {!v.ready ? (
        <Card title={`${v.dayCode}${v.retake ? " (practiced again)" : ""}: skills report`}>
          <p className="text-muted">Being written. Refresh in a few minutes.</p>
        </Card>
      ) : (
        <>
          <Card title={`✓ Skills ${first} showed${v.retake ? " (practiced again)" : ""}`} accent="success">
            {!v.skills.length && <p className="text-muted">Skills show up here as {first} builds them.</p>}
            <SkillChips groups={v.skills} />
          </Card>
          <Card title="→ Skills to practice" description="Each one names the card to review.">
            {!v.tips.length && <p className="text-muted">Nothing this time.</p>}
            <PracticeList items={v.tips.map((text, n) => ({ text, tag: v.tipTags[n] ?? null }))} />
          </Card>
          {v.important.length > 0 && (
            <Notice tone="warning" title="Important to review">
              {v.important.map((a) => (
                <p key={a}>{a}</p>
              ))}
              <p>Please go over {v.important.length === 1 ? "this" : "these"} with {first} when you can.</p>
            </Notice>
          )}
        </>
      )}
    </>
  );
}

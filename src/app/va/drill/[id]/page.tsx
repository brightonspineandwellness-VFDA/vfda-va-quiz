import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ButtonLink, EmptyState } from "@/components/ui";
import { doneMessage, QuizDone } from "@/components/va/quiz-done";
import { RetakeCompare } from "@/components/va/retake-compare";
import { ScenarioRunner } from "@/components/va/scenario-runner";
import { requireRole } from "@/lib/auth";
import { afterAttemptGraded } from "@/lib/va-reports";
import { loadRetakeComparison } from "@/lib/retake";
import { createAdminClient } from "@/lib/supabase/server";
import { percentOf, RESULT_LABELS } from "@/lib/va-flow";
import { loadDrillScreen, type FinishedDay } from "@/lib/va-training";

// A workflow recheck, or a day's retake: same screen as a training day.
// Grading runs in the answer action; the report goes out after the last item.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DrillPage({ params }: PageProps<"/va/drill/[id]">) {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <Drill params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Drill({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("va");
  const { id } = await params;
  if (!UUID.test(id)) redirect("/va");
  const screen = await loadDrillScreen(user, id);
  if (screen.kind === "closed") redirect("/va");
  if (screen.kind === "empty")
    return (
      <EmptyState title="This has no scenarios yet" action={<ButtonLink href="/va">Back to Today</ButtonLink>}>
        Check back later.
      </EmptyState>
    );
  if (screen.kind === "finished") {
    const { attemptId, fresh } = screen.result;
    if (fresh) after(() => afterAttemptGraded(attemptId));
    return <Finished result={screen.result} />;
  }
  const { item } = screen;
  return <ScenarioRunner key={`${item.scenarioId}:${item.phase}`} initial={item} />;
}

async function Finished({ result }: { result: FinishedDay }) {
  // Only this VA's own attempt gets here (loadDrillScreen checked it).
  const retake = result.drill === "retake" ? await loadRetakeComparison(createAdminClient(), result.attemptId) : null;
  const points = retake ? retake.retake.points : result.points;
  const max = retake ? retake.retake.max : result.max;
  const label = retake?.retake.result ?? result.result;
  return (
    <QuizDone
      title={`${result.drill === "retake" ? "Retake done" : "Recheck done"}: ${result.dayCode}`}
      score={`${points} of ${max} points`}
      scoreLabel={max > 0 ? `${percentOf(points, max)}%` : undefined}
      result={label ? RESULT_LABELS[label] : null}
      attemptId={result.attemptId}
      message={<p>{doneMessage(label)}</p>}
    >
      {retake && <RetakeCompare data={retake} />}
    </QuizDone>
  );
}

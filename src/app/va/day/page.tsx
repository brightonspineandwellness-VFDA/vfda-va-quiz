import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ButtonLink, EmptyState } from "@/components/ui";
import { QuizDone } from "@/components/va/quiz-done";
import { ScenarioRunner } from "@/components/va/scenario-runner";
import { requireRole } from "@/lib/auth";
import { percentOf, RESULT_LABELS } from "@/lib/va-flow";
import { loadDayScreen, type FinishedDay } from "@/lib/va-training";
import { afterAttemptGraded } from "@/lib/va-reports";

// Grading a situational answer (and its retry) runs in the answer action;
// the results report is sent after the day's last page.
export const maxDuration = 300;

export default function DayPage() {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <DayScreen />
      </Suspense>
    </SignedInPage>
  );
}

async function DayScreen() {
  const user = await requireRole("va");
  const screen = await loadDayScreen(user);
  if (screen.kind === "closed") redirect("/va");
  if (screen.kind === "empty") {
    return (
      <EmptyState title={`${screen.dayCode} has no scenarios yet`} action={<ButtonLink href="/va">Back to Today</ButtonLink>}>
        Check back later.
      </EmptyState>
    );
  }
  if (screen.kind === "finished") {
    const { attemptId, fresh } = screen.result;
    if (fresh) after(() => afterAttemptGraded(attemptId));
    return <Finished result={screen.result} />;
  }
  const { item } = screen;
  return <ScenarioRunner key={`${item.scenarioId}:${item.phase}`} initial={item} />;
}

// The score right away, and My report (coaching tips are written in a minute
// or two); the next day opens once its cards are done.
function Finished({ result }: { result: FinishedDay }) {
  const retake = !!result.result && result.result !== "strong";
  return (
    <QuizDone
      title={`${result.dayCode} complete`}
      score={result.max > 0 ? `${percentOf(result.points, result.max)}%` : `${result.points}/${result.max}`}
      scoreLabel={`First try: ${result.points}/${result.max}`}
      result={result.result ? RESULT_LABELS[result.result] : null}
      attemptId={result.attemptId}
      retakeAllowed={retake}
      message={
        <>
          {retake && (
            <p>
              {RESULT_LABELS[result.result!]}: you can retake this whole day once, with new details, from Today. It&apos;s optional
              and doesn&apos;t block your next day.
            </p>
          )}
          <p className="text-muted">
            Your report with coaching tips will be ready in a few minutes (we&apos;ll email you). Read it, then go on to your next day.
          </p>
        </>
      }
      extra={<ButtonLink href="/va/proof">Proof of work</ButtonLink>}
    />
  );
}

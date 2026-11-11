import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
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
    return <p>{screen.dayCode} has no scenarios yet. Check back later.</p>;
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
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
      <p className="text-lg font-semibold">{result.dayCode} complete</p>
      <p>
        First try: <span className="font-medium">{result.points}/{result.max}</span>
        {result.max > 0 && ` (${percentOf(result.points, result.max)}%)`}
      </p>
      {result.result && result.result !== "strong" && (
        <p className="text-sm">
          {RESULT_LABELS[result.result]}: you can retake this whole day once, with new details, from Today. It&apos;s
          optional and doesn&apos;t block your next day.
        </p>
      )}
      <p className="text-sm text-foreground/70">
        Your report with coaching tips will be ready in a few minutes (we&apos;ll email you). Read it, then go on to your next day.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href={`/va/results/${result.attemptId}`} className="rounded-lg bg-foreground px-4 py-2 font-medium text-background">
          My report
        </Link>
        <Link href="/va" className="rounded-lg border border-foreground/25 px-4 py-2 font-medium">
          Back to Today
        </Link>
        <Link href="/va/proof" className="rounded-lg border border-foreground/25 px-4 py-2 font-medium">
          Proof of work
        </Link>
      </div>
    </div>
  );
}

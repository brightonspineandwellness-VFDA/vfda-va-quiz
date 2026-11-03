import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { FeedbackList, loadFeedback } from "@/components/va/attempt-feedback";
import { ScenarioRunner } from "@/components/va/scenario-runner";
import { requireRole } from "@/lib/auth";
import { sendAttemptReport } from "@/lib/reports";
import { percentOf } from "@/lib/va-flow";
import { loadDayScreen, type FinishedDay } from "@/lib/va-training";

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
    if (fresh) after(() => sendAttemptReport(attemptId).then(() => undefined));
    return <Finished result={screen.result} />;
  }
  const { item } = screen;
  return <ScenarioRunner key={`${item.scenarioId}:${item.phase}`} initial={item} />;
}

// Score and feedback right away; the next day opens once its cards are done.
async function Finished({ result }: { result: FinishedDay }) {
  const items = (await loadFeedback([result.attemptId])).get(result.attemptId) ?? [];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
      <p className="text-lg font-semibold">{result.dayCode} complete</p>
      <p>
        First try: <span className="font-medium">{result.points}/{result.max}</span>
        {result.max > 0 && ` (${percentOf(result.points, result.max)}%)`}
      </p>
      <div className="text-sm">
        <FeedbackList items={items} />
      </div>
      <p className="text-sm text-foreground/70">Read the feedback, then go on to your next day.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/va" className="rounded-lg bg-foreground px-4 py-2 font-medium text-background">
          Back to Today
        </Link>
        <Link href="/va/proof" className="rounded-lg border border-foreground/25 px-4 py-2 font-medium">
          Proof of work
        </Link>
      </div>
    </div>
  );
}

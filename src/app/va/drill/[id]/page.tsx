import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { FeedbackList, loadFeedback } from "@/components/va/attempt-feedback";
import { ScenarioRunner } from "@/components/va/scenario-runner";
import { requireRole } from "@/lib/auth";
import { sendAttemptReport } from "@/lib/reports";
import { loadDrillScreen, type FinishedDay } from "@/lib/va-training";

// A workflow recheck: same screen as a training day. Grading runs in the
// answer action; the report goes out after the last item.
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
  if (screen.kind === "empty") return <p>This has no scenarios yet. Check back later.</p>;
  if (screen.kind === "finished") {
    const { attemptId, fresh } = screen.result;
    if (fresh) after(() => sendAttemptReport(attemptId).then(() => undefined));
    return <Finished result={screen.result} />;
  }
  const { item } = screen;
  return <ScenarioRunner key={`${item.scenarioId}:${item.phase}`} initial={item} />;
}

async function Finished({ result }: { result: FinishedDay }) {
  const items = (await loadFeedback([result.attemptId])).get(result.attemptId) ?? [];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
      <p className="text-lg font-semibold">Recheck done: {result.dayCode}</p>
      <p>
        First try: <span className="font-medium">{result.points}/{result.max}</span>
      </p>
      <div className="text-sm">
        <FeedbackList items={items} />
      </div>
      <Link href="/va" className="self-start rounded-lg border border-foreground/25 px-4 py-2 font-medium">
        Back to Today
      </Link>
    </div>
  );
}

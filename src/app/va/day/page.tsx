import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ScenarioRunner } from "@/components/va/scenario-runner";
import { requireRole } from "@/lib/auth";
import { showDate } from "@/lib/va-flow";
import { loadDayScreen, type FinishedDay } from "@/lib/va-training";

// Grading a situational answer (and its retry) runs in the answer action.
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
  if (screen.kind === "finished") return <Finished result={screen.result} />;
  const { item } = screen;
  return <ScenarioRunner key={`${item.scenarioId}:${item.phase}`} initial={item} />;
}

function Finished({ result }: { result: FinishedDay }) {
  const text = {
    pass: `You passed ${result.dayCode}. Upload your proof of work so the next day can open.`,
    review: `${result.dayCode} is done. VFDA will review your answers before the next day opens.`,
    retake:
      result.version === "A" && result.retakeOn
        ? `${result.dayCode} needs a retake. Version B opens on ${showDate(result.retakeOn)}.`
        : `${result.dayCode} is done. VFDA will set up a call with you about it.`,
  }[result.result];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
      <p className="text-lg font-semibold">Day complete</p>
      <p>{text}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/va/proof" className="rounded-lg bg-foreground px-4 py-2 font-medium text-background">
          Proof of work
        </Link>
        <Link href="/va" className="rounded-lg border border-foreground/25 px-4 py-2 font-medium">
          Back to Today
        </Link>
      </div>
    </div>
  );
}

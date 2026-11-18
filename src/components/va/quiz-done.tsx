import type { ReactNode } from "react";
import { DayProgress } from "@/components/reports/skills";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";
import { COMPLETED, progressText } from "@/lib/va-flow";

// The end of a quiz, never a score: "Completed ✓", the label, one encouraging
// sentence and "Day X of Y done", then the buttons.
export function QuizDone({
  title,
  result,
  message,
  attemptId,
  progress,
  practice,
  children,
  extra,
}: {
  title: string;
  result: string | null;
  message: ReactNode;
  attemptId: string;
  progress?: { done: number; total: number } | null;
  // "Practice this day again" (optional, once): the button, when allowed.
  practice?: ReactNode;
  children?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <Card bodyClassName="items-center gap-4 text-center">
        <p className="text-sm font-semibold text-muted">{title}</p>
        <p className="text-2xl font-semibold text-foreground">Quiz complete. Well done!</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <StatusBadge label={COMPLETED} size="lg" />
          {result && <StatusBadge label={result} size="lg" />}
        </div>
        <div className="flex max-w-prose flex-col gap-2 text-[0.9375rem] text-foreground">
          {message}
          {progress && <p>{progressText(progress).replace(" completed", " done")}.</p>}
        </div>
        {progress && (
          <div className="w-full max-w-sm">
            <DayProgress progress={progress} compact />
          </div>
        )}
        {children && <div className="w-full text-left">{children}</div>}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
          <ButtonLink href={`/va/results/${attemptId}`} variant="primary">
            See my skills report
          </ButtonLink>
          {practice}
          <ButtonLink href="/va">Back to Today</ButtonLink>
          {extra}
        </div>
      </Card>
    </div>
  );
}

// One encouraging sentence for the "Quiz done" screen.
export const DONE_MESSAGE: Record<string, string> = {
  strong: "Nice work finishing! You clearly know these steps. Your skills report will be ready in a few minutes.",
  needs_coaching: "Nice work finishing! You're building real skills. Your report with the skills you showed and a couple of things to practice will be ready in a few minutes.",
  at_risk: "Thanks for sticking with it! Every quiz builds your skills. Your report with the skills you showed and what to practice will be ready in a few minutes.",
};
export const doneMessage = (result: string | null | undefined) =>
  (result && DONE_MESSAGE[result]) || "Nice work finishing! Your skills report will be ready in a few minutes.";

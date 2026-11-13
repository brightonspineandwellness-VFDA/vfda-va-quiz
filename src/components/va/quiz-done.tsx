import type { ReactNode } from "react";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";

// The end of a quiz: the day, the score ("16 of 20 points"), the label, one
// encouraging sentence, then the buttons.
export function QuizDone({
  title,
  score,
  scoreLabel,
  result,
  message,
  attemptId,
  retakeAllowed = false,
  children,
  extra,
}: {
  title: string;
  score: string;
  scoreLabel?: string;
  result: string | null;
  message: ReactNode;
  attemptId: string;
  retakeAllowed?: boolean;
  children?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <Card bodyClassName="items-center gap-4 text-center">
        <p className="text-sm font-semibold text-muted">{title}</p>
        <div className="flex flex-col items-center gap-1">
          <p className="text-4xl font-semibold tabular-nums text-foreground">{score}</p>
          {scoreLabel && <p className="text-sm text-muted">{scoreLabel}</p>}
        </div>
        {result && <StatusBadge label={result} size="lg" />}
        <div className="flex max-w-prose flex-col gap-2 text-[0.9375rem] text-foreground">{message}</div>
        {children && <div className="w-full text-left">{children}</div>}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
          <ButtonLink href={`/va/results/${attemptId}`} variant="primary">
            See my report
          </ButtonLink>
          {retakeAllowed && <ButtonLink href="/va">Retake this quiz</ButtonLink>}
          <ButtonLink href="/va">Back to Today</ButtonLink>
          {extra}
        </div>
      </Card>
    </div>
  );
}

// One encouraging sentence for the "Quiz done" screen.
export const DONE_MESSAGE: Record<string, string> = {
  strong: "Great job! You clearly know these steps, and your full report will be ready in a few minutes.",
  needs_coaching: "Nice work finishing! You're building real skills, and your report with a few focus tips will be ready in a few minutes.",
  at_risk: "Thanks for sticking with it! Every quiz builds your skills, and your report with tips will be ready in a few minutes.",
};
export const doneMessage = (result: string | null | undefined) =>
  (result && DONE_MESSAGE[result]) || "Nice work finishing! Your report will be ready in a few minutes.";

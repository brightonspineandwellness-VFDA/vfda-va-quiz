import type { ReactNode } from "react";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";

// The end of a quiz: the day, a large score, the result badge, a short
// message, and where to go next.
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
  scoreLabel: string;
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
          <p className="text-5xl font-semibold tabular-nums text-foreground">{score}</p>
          <p className="text-sm text-muted">{scoreLabel}</p>
        </div>
        {result && <StatusBadge label={result} size="lg" />}
        <div className="flex max-w-prose flex-col gap-2 text-[0.9375rem] text-foreground">{message}</div>
        {children && <div className="w-full text-left">{children}</div>}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
          <ButtonLink href={`/va/results/${attemptId}`} variant="primary">
            See my report &amp; coaching tips
          </ButtonLink>
          {retakeAllowed && <ButtonLink href="/va">Retake this quiz</ButtonLink>}
          <ButtonLink href="/va">Back to Today</ButtonLink>
          {extra}
        </div>
      </Card>
    </div>
  );
}

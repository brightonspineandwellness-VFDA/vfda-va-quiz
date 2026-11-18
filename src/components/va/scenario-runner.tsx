"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Badge, buttonClass, Card, Notice, ProgressBar } from "@/components/ui";
import { answerItem } from "@/lib/va-actions";
import { ANSWER_BOXES, niceWorkLine, type Feedback, type PasteEvent, type ServedItem } from "@/lib/va-flow";

// One scenario per screen. Answers can't be changed after submitting: the
// server only accepts the item on screen, once, then serves the next one.
export function ScenarioRunner({ initial }: { initial: ServedItem }) {
  const router = useRouter();
  const [item, setItem] = useState(initial);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (feedback) {
    return (
      <div className="flex flex-col gap-4">
        <QuizProgress item={item} />
        <FeedbackCard feedback={feedback} title={feedback.ungraded ? "Saved" : "Feedback"} />
        <div className="flex justify-end">
          <button type="button" onClick={() => router.refresh()} className={buttonClass("primary")}>
            Next →
          </button>
        </div>
      </div>
    );
  }

  return (
    <AnswerForm
      key={`${item.scenarioId}:${item.phase}`}
      item={item}
      onDone={(outcome) => {
        if (outcome.repeat) setItem(outcome.repeat);
        else if (outcome.feedback) setFeedback(outcome.feedback);
        else router.refresh();
      }}
    />
  );
}

// Texting items are "The message"; everything else is a call.
const isText = (item: ServedItem) => item.workflow === "WF05";

function typeLabel(item: ServedItem) {
  if (item.type === "mc") return "Multiple choice";
  if (item.type === "describe") return "Explain in your own words";
  return `Situation · ${isText(item) ? "Text" : "Phone"}`;
}

// "Question X of Y", the teal progress bar and the no-going-back note.
function QuizProgress({ item }: { item: ServedItem }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold text-foreground">
          Question {item.number} of {item.total}
        </p>
        <p className="text-sm text-muted">
          {item.dayCode} · {item.dayTitle}
        </p>
      </div>
      <ProgressBar value={item.number - 1} max={item.total} label={`Question ${item.number} of ${item.total}`} />
      <p className="text-sm text-muted">You can&apos;t go back after submitting.</p>
    </div>
  );
}

// After a situation, never the points: "Nice work on…" first, then
// "Something to practice:" (at most three) and the card to review. Never
// "wrong", "failed" or "missed" on VA screens.
function FeedbackCard({ feedback, title }: { feedback: Feedback; title: string }) {
  const practice = feedback.missedSteps.slice(0, 3);
  // Older grades have no "did well" line; their reason is shown instead when there's nothing to practice.
  const good = feedback.didWell?.trim() || (!feedback.ungraded && !practice.length ? feedback.reason : "");
  const niceWork = good ? niceWorkLine(good) : "";
  return (
    <Card title={title} headingAs="h3" actions={feedback.ungraded ? <Badge tone="neutral">Waiting for VFDA</Badge> : undefined}>
      {feedback.ungraded && feedback.reason && <p className="text-[0.9375rem]">{feedback.reason}</p>}
      {!feedback.ungraded && niceWork && <p className="text-[0.9375rem]">{niceWork}</p>}
      {practice.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">Something to practice:</p>
          <ul className="ml-5 flex list-disc flex-col gap-1 text-[0.9375rem]">
            {practice.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {feedback.review && practice.length > 0 && (
        <p className="text-[0.9375rem]">
          <span className="font-semibold">Review:</span> {feedback.review}
        </p>
      )}
    </Card>
  );
}

function AnswerForm({
  item,
  onDone,
}: {
  item: ServedItem;
  onDone: (outcome: { feedback: Feedback | null; repeat: ServedItem | null }) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<Record<string, string>>({});
  // Pastes are logged for VFDA, never blocked.
  const pastes = useRef<PasteEvent[]>([]);
  const fields = ANSWER_BOXES[item.format];
  const isMc = item.type === "mc";
  const ready = isMc ? choice !== null : fields.some((f) => boxes[f.key]?.trim());
  const repeat = item.phase === "repeat";

  function submit() {
    startTransition(async () => {
      setError(null);
      const result = await answerItem(
        item.scenarioId,
        item.phase,
        isMc ? { choice: choice! } : { boxes, pastes: pastes.current },
        item.drillId,
      );
      if (result.ok) onDone(result.data);
      else {
        setError(result.error);
        if (result.error.includes("already answered")) router.refresh();
      }
    });
  }

  const question = (
    <>
      {isMc || item.type === "describe" ? (
        <p className="whitespace-pre-line text-lg text-foreground">{item.stem}</p>
      ) : (
        <Notice tone="info" title={isText(item) ? "The message" : "The call"}>
          <p className="whitespace-pre-line text-base">{item.stem}</p>
        </Notice>
      )}

      {isMc ? (
        <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Answers">
          {(item.options ?? []).map((option, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={choice === i}
              disabled={pending}
              onClick={() => setChoice(i)}
              className={`flex min-h-12 w-full items-start gap-3 rounded-[var(--radius-card)] border-2 bg-surface px-4 py-3 text-left text-base transition-colors ${
                choice === i ? "border-primary bg-primary-soft font-medium" : "border-line hover:border-line-strong hover:bg-surface-zebra"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-1 inline-block h-4 w-4 shrink-0 rounded-full border-2 ${choice === i ? "border-primary bg-primary" : "border-line-strong"}`}
              />
              <span className="min-w-0">{option}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Describe what you would do. You&apos;re graded on your approach and order, not exact buttons, wording or grammar.
          </p>
          {fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-foreground">{f.label}</span>
              <span className="text-sm text-muted">{f.hint}</span>
              <textarea
                rows={5}
                value={boxes[f.key] ?? ""}
                disabled={pending}
                onChange={(e) => setBoxes({ ...boxes, [f.key]: e.target.value })}
                onPaste={(e) =>
                  pastes.current.push({
                    box: f.key,
                    chars: e.clipboardData.getData("text").length,
                    at: new Date().toISOString(),
                  })
                }
                maxLength={5000}
                className="w-full resize-y"
              />
            </label>
          ))}
        </div>
      )}
    </>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !pending) submit();
      }}
    >
      <QuizProgress item={item} />
      {item.priorFeedback && <FeedbackCard feedback={item.priorFeedback} title="Feedback" />}

      <Card
        accent={repeat ? "accent" : undefined}
        title={repeat ? "Let's try one more" : item.partTitle || typeLabel(item)}
        description={repeat ? "Same skill, new details. Use the feedback above." : undefined}
        headingAs="h2"
        actions={<Badge tone={repeat ? "accent" : "primary"}>{typeLabel(item)}</Badge>}
      >
        {question}
      </Card>

      <div className="flex flex-col items-end gap-2">
        <button type="submit" disabled={!ready || pending} className={buttonClass("primary")}>
          {pending ? (isMc ? "Saving…" : "Checking your answer…") : repeat ? "Submit and continue" : "Submit answer"}
        </button>
        {error && (
          <p className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

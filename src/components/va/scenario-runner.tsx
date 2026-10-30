"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { answerItem } from "@/lib/va-actions";
import { ANSWER_BOXES, type Feedback, type PasteEvent, type ServedItem } from "@/lib/va-flow";

// One scenario per screen. Answers can't be changed after submitting: the
// server only accepts the item on screen, once, then serves the next one.
export function ScenarioRunner({ initial }: { initial: ServedItem }) {
  const router = useRouter();
  const [item, setItem] = useState(initial);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (feedback) {
    return (
      <div className="flex flex-col gap-4">
        <ItemHeader item={item} />
        <FeedbackBox feedback={feedback} title={feedback.missedSteps.length ? "What you missed" : "Saved"} />
        <button
          type="button"
          onClick={() => router.refresh()}
          className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background"
        >
          Next →
        </button>
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

function ItemHeader({ item }: { item: ServedItem }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-foreground/60">
        {item.dayCode} · {item.dayTitle} · Item {item.number} of {item.total}
        {item.partTitle && ` · ${item.partTitle}`}
      </p>
      {item.phase === "repeat" && (
        <p className="self-start rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Repeat: same skill, new details
        </p>
      )}
    </div>
  );
}

function FeedbackBox({ feedback, title }: { feedback: Feedback; title: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3">
      <p className="font-medium">{title}</p>
      <p className="text-sm">{feedback.reason}</p>
      {feedback.missedSteps.length > 0 && (
        <ul className="ml-5 list-disc text-sm">
          {feedback.missedSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {!feedback.ungraded && feedback.missedSteps.length > 0 && !feedback.repeatNext && (
        <p className="text-sm text-foreground/60">VFDA will go over this one with you.</p>
      )}
    </div>
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

  function submit() {
    startTransition(async () => {
      setError(null);
      const result = await answerItem(
        item.scenarioId,
        item.phase,
        isMc ? { choice: choice! } : { boxes, pastes: pastes.current },
      );
      if (result.ok) onDone(result.data);
      else {
        setError(result.error);
        if (result.error.includes("already answered")) router.refresh();
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !pending) submit();
      }}
    >
      <ItemHeader item={item} />
      {item.priorFeedback && <FeedbackBox feedback={item.priorFeedback} title="What you missed on the first try" />}
      {item.phase === "repeat" && <p className="font-medium">Now try this one:</p>}
      <p className="whitespace-pre-line text-lg">{item.stem}</p>

      {isMc ? (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Answers">
          {(item.options ?? []).map((option, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={choice === i}
              disabled={pending}
              onClick={() => setChoice(i)}
              className={`rounded-lg border px-4 py-3 text-left ${
                choice === i ? "border-foreground bg-foreground/10 font-medium" : "border-foreground/20 hover:bg-foreground/5"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground/60">
            Describe what you would do. You&apos;re graded on your approach and order, not exact buttons, wording or
            grammar.
          </p>
          {fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="font-medium">
                {f.label} <span className="font-normal text-foreground/60">· {f.hint}</span>
              </span>
              <textarea
                rows={4}
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
                className="rounded-lg border border-foreground/20 bg-transparent px-3 py-2"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={!ready || pending}
          className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-60"
        >
          {pending ? (isMc ? "Saving…" : "Grading your answer…") : "Submit answer"}
        </button>
        <p className="text-sm text-foreground/60">You can&apos;t go back or change an answer after you submit it.</p>
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </form>
  );
}

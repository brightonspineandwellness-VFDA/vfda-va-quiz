// Shows quiz-bank text with each {PLACEHOLDER} highlighted, so it's clear what
// gets filled in per office.
export function BankText({ text }: { text: string }) {
  const parts = text.split(/(\{[A-Z][A-Z0-9_]*\})/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded bg-amber-100 px-1 text-[0.9em] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
          >
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function pointsLabel(quiz: {
  max_points: number | null;
  pass_points: number | null;
  review_min_points: number | null;
}) {
  return quiz.max_points === null
    ? "Points set per office"
    : `${quiz.max_points} pts · pass ${quiz.pass_points} · review ${quiz.review_min_points}`;
}

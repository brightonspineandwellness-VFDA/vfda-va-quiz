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
            className="rounded bg-warning-soft px-1 text-[0.9em] text-warning ring-1 ring-warning/30"
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
    : `${quiz.max_points} pts · labels: Strong 80%+, Needs coaching 60-79%, At risk below 60%`;
}

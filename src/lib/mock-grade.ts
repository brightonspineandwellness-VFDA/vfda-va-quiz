// Mock grading (AI_MODE=mock): a stand-in for Claude when there's no API key
// or credit, for demos and tests. It checks the required steps by keywords, so
// it's only a rough guess. Never use it for real VAs.
//
// Test words in an answer: "#critical" makes a critical error (quoting that
// line), "#low" a low-confidence grade, "#invalid" an answer the grader can't
// produce (the item is saved as "needs review").

export type MockGrade = {
  score: 0 | 1 | 2;
  did_well: string;
  reason: string;
  missed_steps: string[];
  critical_error: boolean;
  critical_quote: string | null;
  confidence: "high" | "medium" | "low";
};

const STOP = new Set([
  "about", "after", "again", "asks", "before", "being", "check", "checks", "doesn't", "every", "explains", "first",
  "their", "there", "these", "thing", "which", "while", "would", "patient", "patients", "with", "without", "never",
]);

// The required steps of a correct_response: a list, or {Say, Do, Book} lists.
export function requiredSteps(correctResponse: unknown): string[] {
  if (Array.isArray(correctResponse)) return correctResponse.map(String);
  if (correctResponse && typeof correctResponse === "object") {
    return Object.entries(correctResponse as Record<string, unknown>).flatMap(([part, v]) =>
      (Array.isArray(v) ? v : [v]).map((s) => `${part}: ${String(s)}`),
    );
  }
  return typeof correctResponse === "string" ? [correctResponse] : [];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\{[A-Z_]+\}/gi, " ")
    .split(/[^a-z']+/)
    .filter((w) => w.length >= 5 && !STOP.has(w));

const covers = (answer: Set<string>, step: string) => {
  const keys = [...new Set(words(step.replace(/^(say|do|book):/i, "")))];
  if (!keys.length) return true;
  // A word counts when its first 5 letters appear ("booking" matches "book" steps' "booked").
  const stems = new Set([...answer].map((w) => w.slice(0, 5)));
  return keys.filter((k) => stems.has(k.slice(0, 5))).length * 2 >= keys.length;
};

export function mockGrade(correctResponse: unknown, answerText: string): MockGrade | null {
  if (answerText.includes("#invalid")) return null;
  const steps = requiredSteps(correctResponse);
  const answer = new Set(words(answerText));
  const missed = steps.filter((s) => !covers(answer, s));
  const criticalLine = answerText.split("\n").find((l) => l.includes("#critical"));
  // The lenient rubric (src/lib/ai.ts GRADING_RUBRIC): 2 = about 80% of the
  // steps covered, 1 = 40-79%, 0 = under 40%. A critical error is never 2.
  const covered = steps.length ? (steps.length - missed.length) / steps.length : 1;
  const score: 0 | 1 | 2 = criticalLine ? 0 : covered >= 0.8 ? 2 : covered >= 0.4 ? 1 : 0;
  return {
    score,
    did_well: covered > 0 ? "Mock grade: you covered several of the key steps." : "Mock grade: you gave the question a full try.",
    reason: criticalLine
      ? "Mock grade: this answer did something the scenario lists as a critical fail."
      : score === 2
        ? "Mock grade: you covered the key steps."
        : `Mock grade: ${steps.length - missed.length} of ${steps.length} key steps covered.`,
    missed_steps: score === 2 ? [] : (missed.length ? missed : ["(mock) a key step"]).slice(0, 3),
    critical_error: !!criticalLine,
    critical_quote: criticalLine?.trim() ?? null,
    confidence: answerText.includes("#low") || answerText.trim().length < 20 ? "low" : "high",
  };
}

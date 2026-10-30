import Link from "next/link";
import { Suspense } from "react";
import { LockedStep, nextButton } from "@/components/setup/locked-step";
import { RuleEditor } from "@/components/setup/rule-editor";
import { RuleSource } from "@/components/setup/rule-source";
import { RuleValue } from "@/components/setup/rule-value";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import type { QuestionItem } from "@/lib/doctor-flow";
import type { AnswerValue, InterviewQuestion } from "@/lib/interview";
import { answerGapQuestion } from "@/lib/setup-actions";
import { loadDoctorSetup } from "../load";

export default function QuestionsPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/confirm" className="text-sm text-foreground/60 hover:underline">
        ← Confirm your rules
      </Link>
      <Suspense fallback={<Loading />}>
        <QuestionsStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 5: only the gap questions: rules the cards didn't cover, covered in
// part, or said different things about, plus a few edge cases.
async function QuestionsStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  const total = flow.questions.length;
  const answered = total - flow.openQuestions;

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="questions" />
      <div>
        <h2 className="text-xl font-semibold">Step 5 · Questions for you</h2>
        {flow.unlocked && (
          <p className="text-lg">
            {total === 1 ? "1 question" : `${total} questions`}
            {answered > 0 && <span className="text-foreground/60"> · {answered} answered</span>}
          </p>
        )}
        <p className="text-foreground/70">Only what your cards didn&apos;t answer. Short answers are fine.</p>
      </div>

      {!flow.unlocked ? (
        <LockedStep />
      ) : (
        <>
          {total === 0 && <p className="text-foreground/70">Your cards covered everything. No questions for you.</p>}
          <ol className="flex flex-col gap-3">
            {flow.questions.map((item, i) => (
              <li key={item.gap.id}>
                <Question item={item} number={i + 1} officeId={interview.office.id} fileUrls={interview.fileUrls} />
              </li>
            ))}
          </ol>
          <Link href="/doctor/setup/standards" className={nextButton}>
            Next: VFDA standards →
          </Link>
        </>
      )}
    </>
  );
}

const REASON_LABELS = {
  not_found: "Not on your cards",
  partial: "Your card covers part of this",
  conflicting: "Your cards say different things",
  edge_case: "Not covered by your cards",
};

function Question({
  item,
  number,
  officeId,
  fileUrls,
}: {
  item: QuestionItem;
  number: number;
  officeId: string;
  fileUrls: Record<string, string>;
}) {
  const { gap, versions } = item;
  // Edge cases have no rule slot: a short written answer.
  const slot: InterviewQuestion = item.slot ?? {
    key: `EDGE_${gap.workflow ?? gap.id}`,
    tier: "doctor",
    card_group: null,
    suggested_answer: null,
    quiz: "",
    question: gap.question,
    answer_type: "text",
    condition: "always",
    source: "",
  };
  const answered = gap.answered_at !== null;
  const suggestion = gap.reason === "not_found" ? slot.suggested_answer : null;
  // A starting point only: nothing is saved until the doctor presses Save.
  const start: AnswerValue = answered
    ? gap.answer
    : (suggestion ?? (gap.reason === "partial" && versions.length === 1 ? versions[0].rule : null));

  return (
    <article
      id={`q-${gap.id}`}
      className={`flex flex-col gap-2 rounded-lg border p-4 ${answered ? "border-foreground/15" : "border-amber-300 dark:border-amber-700"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">
          {number}. {item.slot?.question ?? gap.question}
        </p>
        {answered && (
          <span className="shrink-0 text-green-700 dark:text-green-400" aria-label="Answered">
            ✓
          </span>
        )}
      </div>
      <p className="text-xs text-foreground/60">
        {REASON_LABELS[gap.reason]}
        {gap.reason === "edge_case" && gap.workflow && ` · ${gap.workflow}`}
      </p>

      {answered ? (
        <>
          <div className="text-sm">
            <RuleValue slot={slot} value={gap.answer} />
          </div>
          <p className="text-xs text-foreground/60">Your answer</p>
        </>
      ) : (
        <>
          {versions.length > 0 && (
            <div className="flex flex-col gap-2 text-sm">
              {versions.map((v) => (
                <div key={v.id} className="rounded-md bg-foreground/5 px-3 py-2">
                  <RuleValue slot={slot} value={v.rule} />
                  <RuleSource row={v} />
                </div>
              ))}
              <p className="text-foreground/70">
                {gap.reason === "conflicting"
                  ? "Which is right? Type the rule your VA should follow."
                  : "Fill in the rest below."}
              </p>
            </div>
          )}
          {suggestion && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-foreground/70">VFDA suggests:</p>
              <div className="rounded-md bg-foreground/5 px-3 py-2">
                <RuleValue slot={slot} value={suggestion} />
              </div>
              <p className="text-foreground/70">Save it as is, or change it to fit your office.</p>
            </div>
          )}
        </>
      )}

      <RuleEditor
        // Remount once answered, so the box closes.
        key={answered ? "answered" : "open"}
        officeId={officeId}
        slot={slot}
        value={start}
        fileUrls={fileUrls}
        save={answerGapQuestion.bind(null, gap.id)}
        files={item.slot !== null}
        startOpen={!answered}
        editLabel="Change answer"
      />
    </article>
  );
}

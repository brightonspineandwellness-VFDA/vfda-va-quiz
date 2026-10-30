"use client";

import { useMemo, useState } from "react";
import {
  addGrayCard,
  deleteGrayCard,
  deleteInterviewFile,
  saveGrayCard,
  saveInterviewAnswer,
  addInterviewFile,
  setGrayCardRisk,
} from "@/lib/interview-actions";
import {
  buildSections,
  computeProgress,
  emptyValue,
  isAnswered,
  profileFromAnswers,
  type Answer,
  type AnswerValue,
  type Attachment,
  type GrayCard,
  type InterviewQuestion,
  type MatrixRow,
  type RiskTag,
  type UploadValue,
} from "@/lib/interview";
import type { InterviewData } from "@/lib/interview-data";
import {
  choiceOptions,
  FileUploads,
  LinesAnswer,
  MatrixAnswer,
  OptionsAnswer,
  TextAnswer,
  UploadAnswer,
  YES_NO,
} from "./answer-inputs";
import { GrayCards } from "./gray-cards";
import { SaveBadge } from "./save-badge";
import { ToolsAnswer } from "./tools-answer";
import { useAutosave } from "./use-autosave";

const INSTANT_TYPES = new Set(["yesno", "choice"]);

const TIER_LABELS = {
  profile: "Profile",
  doctor: "Doctor (cards)",
  default: "VFDA standard",
  auto: "Auto",
} as const;
const SOURCE_LABELS = {
  doctor: "doctor",
  vfda: "VFDA",
  vfda_default: "VFDA default",
  auto: "filled automatically",
  card_import: "card",
} as const;

export function InterviewForm({ data, isAdmin }: { data: InterviewData; isAdmin: boolean }) {
  const officeId = data.office.id;
  const [answers, setAnswers] = useState<Record<string, Answer>>(data.answers);
  const [grayCards, setGrayCards] = useState<GrayCard[]>(data.grayCards);
  const [fileUrls, setFileUrls] = useState(data.fileUrls);
  const autosave = useAutosave();

  const profile = useMemo(() => profileFromAnswers(answers), [answers]);
  const sections = useMemo(
    () => buildSections(data.questions, data.quizzes, data.conditions, profile),
    [data.questions, data.quizzes, data.conditions, profile],
  );
  const progress = computeProgress(sections, answers, profile, grayCards, data.grayCardQuestions);
  const addons = Array.isArray(answers.ADDONS?.value) ? (answers.ADDONS.value as string[]) : [];

  const updateAnswer = (key: string, change: (a: Answer) => Answer) =>
    setAnswers((prev) => ({ ...prev, [key]: change(prev[key] ?? { value: null, attachments: [] }) }));

  // Each save carries its own value; only the latest queued one is sent.
  function setValue(question: InterviewQuestion, value: AnswerValue) {
    updateAnswer(question.key, (a) => ({ ...a, value }));
    autosave.save(
      `answer:${question.key}`,
      () => saveInterviewAnswer(officeId, question.key, value),
      INSTANT_TYPES.has(question.answer_type) ? 0 : 800,
    );
  }

  async function addFile(key: string, file: Attachment, url: string | null) {
    const result = await addInterviewFile(officeId, key, file);
    if (!result.ok) return result.error;
    updateAnswer(key, (a) => ({ ...a, attachments: [...a.attachments.filter((f) => f.path !== file.path), file] }));
    if (url) setFileUrls((u) => ({ ...u, [file.path]: url }));
    return null;
  }

  async function removeFile(key: string, path: string) {
    const result = await deleteInterviewFile(officeId, key, path);
    if (!result.ok) return result.error;
    updateAnswer(key, (a) => ({ ...a, attachments: result.data }));
    return null;
  }

  async function addCard(name?: string) {
    const result = await addGrayCard(officeId, name);
    if (result.ok) setGrayCards((prev) => [...prev, result.data]);
  }

  function changeCard(cardId: string, key: string, value: string) {
    const card = grayCards.find((c) => c.id === cardId);
    if (!card) return;
    const cardAnswers = { ...card.answers, [key]: value };
    setGrayCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, answers: cardAnswers } : c)));
    autosave.save(`card:${cardId}`, () => saveGrayCard(officeId, cardId, cardAnswers));
  }

  async function removeCard(cardId: string) {
    autosave.cancel(`card:${cardId}`);
    const result = await deleteGrayCard(officeId, cardId);
    if (result.ok) setGrayCards((prev) => prev.filter((c) => c.id !== cardId));
  }

  function setRisk(cardId: string, risk: RiskTag | null) {
    setGrayCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, risk_tag: risk } : c)));
    autosave.save(`card:${cardId}:risk`, () => setGrayCardRisk(officeId, cardId, risk), 0);
  }

  function input(q: InterviewQuestion) {
    const answer = answers[q.key];
    const value = answer?.value ?? emptyValue(q);
    const files = (accept: string, label: string) => (
      <FileUploads
        officeId={officeId}
        folder={q.key}
        label={label}
        accept={accept}
        files={answer?.attachments ?? []}
        urls={fileUrls}
        onAdded={(file, url) => addFile(q.key, file, url)}
        onRemove={(path) => removeFile(q.key, path)}
      />
    );
    switch (q.answer_type) {
      case "text":
        return <TextAnswer label={q.question} value={(value as string) ?? ""} onChange={(v) => setValue(q, v)} />;
      case "yesno":
        return <OptionsAnswer name={q.key} options={YES_NO} value={(value as string) ?? ""} onChange={(v) => setValue(q, v)} />;
      case "choice": {
        const options = choiceOptions(q.key);
        return options.length ? (
          <OptionsAnswer name={q.key} options={options} value={(value as string) ?? ""} onChange={(v) => setValue(q, v)} />
        ) : (
          <TextAnswer label={q.question} value={(value as string) ?? ""} onChange={(v) => setValue(q, v)} />
        );
      }
      case "list":
        if (q.key === "APPROVED_TOOLS") {
          return <ToolsAnswer lines={(value as string[]) ?? []} onChange={(v) => setValue(q, v)} />;
        }
        return <LinesAnswer lines={(value as string[]) ?? []} onChange={(v) => setValue(q, v)} />;
      case "matrix":
        return <MatrixAnswer rows={(value as MatrixRow[]) ?? []} onChange={(v) => setValue(q, v)} />;
      case "upload": {
        // A plain-text value (older VFDA defaults) is shown as the text.
        const upload = typeof value === "string" ? { text: value, links: [] } : (value as UploadValue);
        return (
          <UploadAnswer
            value={{ text: upload?.text ?? "", links: upload?.links ?? [] }}
            onChange={(v) => setValue(q, v)}
            files={files(".pdf,.doc,.docx,.txt,image/*,video/*", "Files (PDF, Word, text, image, video up to 50 MB)")}
          />
        );
      }
    }
  }

  const sectionTitle = (code: string) => sections.find((s) => s.code === code)?.title ?? code;

  return (
    <div className="flex flex-col gap-8">
      {/* Progress, save status and the unanswered list stay in view. Doctors see
          progress by step on the page instead of a question count. */}
      <div className="sticky top-[env(safe-area-inset-top,0px)] z-10 -mx-6 border-b border-foreground/10 bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4 text-sm">
          {isAdmin ? (
            <p>
              <strong>{progress.done}</strong> of {progress.total} answered ({progress.percent}%)
            </p>
          ) : (
            <p className="text-foreground/70">Everything saves as you type.</p>
          )}
          <p
            className={
              autosave.failed ? "text-red-700 dark:text-red-400" : "text-foreground/60"
            }
            aria-live="polite"
          >
            {autosave.failed
              ? `${autosave.failed} change${autosave.failed > 1 ? "s" : ""} not saved`
              : autosave.saving
                ? "Saving…"
                : "All changes saved"}
          </p>
        </div>
        {isAdmin && (
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/10"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Interview progress"
        >
          <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
        )}
        {isAdmin && progress.unanswered.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-foreground/70">Unanswered ({progress.unanswered.length})</summary>
            <ul className="mt-2 max-h-64 overflow-y-auto pr-2">
              {progress.unanswered.map((u) => (
                <li key={u.anchor}>
                  <a href={`#${u.anchor}`} className="block truncate py-0.5 hover:underline">
                    <span className="mr-2 font-mono text-xs text-foreground/50">
                      {u.section === "PROFILE" ? "Profile" : u.section}
                    </span>
                    {u.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {sections.map((section) => (
        <section key={section.code} className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              {section.code === "PROFILE" ? section.title : `${section.code} · ${sectionTitle(section.code)}`}
            </h2>
            {section.code === "PROFILE" && (
              <p className="text-sm text-foreground/60">
                {isAdmin
                  ? "Answer these first: they switch quiz days and questions on or off for this office."
                  : "These decide which training days and rules apply to your office."}
              </p>
            )}
            {section.hidden > 0 && (
              <p className="text-sm text-foreground/60">
                {section.questions.length === 0
                  ? "This day doesn't apply to this office, based on the profile answers."
                  : `${section.hidden} question${section.hidden > 1 ? "s" : ""} hidden: they don't apply to this office.`}
              </p>
            )}
          </div>
          {section.questions.map((q) => {
            const done = isAnswered(q, answers[q.key]);
            return (
              <div key={q.key} id={`q-${q.key}`} className="scroll-mt-40 rounded-lg border border-foreground/15 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{q.question}</p>
                    {isAdmin && (
                      <p className="mt-0.5 text-xs text-foreground/50">
                        <span className="font-mono">{q.key}</span> · {TIER_LABELS[q.tier]}
                        {q.suggested_answer !== null && " (has a VFDA suggestion)"}
                        {data.sources[q.key] && ` · from ${SOURCE_LABELS[data.sources[q.key].source]}`}
                        {q.source && ` · ${q.source}`}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <SaveBadge
                      state={autosave.states[`answer:${q.key}`]}
                      onRetry={() => autosave.retry(`answer:${q.key}`)}
                    />
                    {done && (
                      <span className="text-green-700 dark:text-green-400" aria-label="Answered">
                        ✓
                      </span>
                    )}
                  </div>
                </div>
                {input(q)}
              </div>
            );
          })}
        </section>
      ))}

      {profile.HAS_GRAY_CARDS === "yes" && (
        <GrayCards
          cards={grayCards}
          questions={data.grayCardQuestions}
          addons={addons}
          isAdmin={isAdmin}
          saveStates={autosave.states}
          onAdd={addCard}
          onChange={changeCard}
          onRemove={removeCard}
          onRisk={setRisk}
          onRetry={autosave.retry}
        />
      )}
    </div>
  );
}

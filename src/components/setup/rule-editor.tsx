"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  choiceOptions,
  FileUploads,
  LinesAnswer,
  MatrixAnswer,
  OptionsAnswer,
  TextAnswer,
  UploadAnswer,
  YES_NO,
} from "@/components/interview/answer-inputs";
import { addInterviewFile, deleteInterviewFile, saveInterviewAnswer } from "@/lib/interview-actions";
import {
  emptyValue,
  type AnswerValue,
  type Attachment,
  type InterviewQuestion,
  type MatrixRow,
  type UploadValue,
} from "@/lib/interview";

const button = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60";

// "Edit" for one rule (or the answer box for a short question). Saving writes
// the office's direct rule as the doctor's own answer, then reloads the page.
export function RuleEditor({
  officeId,
  slot,
  value,
  attachments = [],
  fileUrls = {},
  startOpen = false,
  editLabel = "Edit",
}: {
  officeId: string;
  slot: InterviewQuestion;
  value: AnswerValue;
  attachments?: Attachment[];
  fileUrls?: Record<string, string>;
  startOpen?: boolean;
  editLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState<AnswerValue>(() => normalize(slot, value));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${button} border border-foreground/25 hover:bg-foreground/5`}>
        {editLabel}
      </button>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveInterviewAnswer(officeId, slot.key, draft);
      if (!result.ok) return setError(result.error);
      if (!startOpen) setOpen(false);
      router.refresh();
    });
  }

  const fileProps = {
    officeId,
    folder: slot.key,
    files: attachments,
    urls: fileUrls,
    onAdded: async (file: Attachment) => {
      const r = await addInterviewFile(officeId, slot.key, file);
      if (r.ok) router.refresh();
      return r.ok ? null : r.error;
    },
    onRemove: async (path: string) => {
      const r = await deleteInterviewFile(officeId, slot.key, path);
      if (r.ok) router.refresh();
      return r.ok ? null : r.error;
    },
  };

  return (
    <div className="flex flex-col gap-2">
      {input(slot, draft, setDraft, fileProps)}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className={`${button} bg-foreground text-background`}>
          {pending ? "Saving…" : "Save"}
        </button>
        {!startOpen && (
          <button
            type="button"
            onClick={() => {
              setDraft(normalize(slot, value));
              setOpen(false);
            }}
            className={`${button} hover:bg-foreground/5`}
          >
            Cancel
          </button>
        )}
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}

// Older values may be plain text where the slot now expects {text, links}.
function normalize(slot: InterviewQuestion, value: AnswerValue): AnswerValue {
  if (value === null || value === undefined) return emptyValue(slot);
  if (slot.answer_type === "upload" && typeof value === "string") return { text: value, links: [] };
  return value;
}

function input(
  slot: InterviewQuestion,
  value: AnswerValue,
  set: (v: AnswerValue) => void,
  fileProps: Omit<Parameters<typeof FileUploads>[0], "label" | "accept">,
) {
  switch (slot.answer_type) {
    case "yesno":
      return <OptionsAnswer name={slot.key} options={YES_NO} value={(value as string) ?? ""} onChange={set} />;
    case "choice": {
      const options = choiceOptions(slot.key);
      if (options.length) return <OptionsAnswer name={slot.key} options={options} value={(value as string) ?? ""} onChange={set} />;
      return <TextAnswer label={slot.question} value={(value as string) ?? ""} onChange={set} />;
    }
    case "list":
      return <LinesAnswer lines={(value as string[]) ?? []} onChange={set} />;
    case "matrix":
      return <MatrixAnswer rows={(value as MatrixRow[]) ?? []} onChange={set} />;
    case "upload": {
      const v = value as UploadValue;
      return (
        <UploadAnswer
          value={{ text: v?.text ?? "", links: v?.links ?? [] }}
          onChange={set}
          files={<FileUploads {...fileProps} label="Files (PDF, Word, text, image, video up to 50 MB)" accept=".pdf,.doc,.docx,.txt,image/*,video/*" />}
        />
      );
    }
    default:
      return <TextAnswer label={slot.question} value={(value as string) ?? ""} onChange={set} />;
  }
}

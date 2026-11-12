"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ByLine } from "@/components/setup/by-line";
import { buttonClass, Notice } from "@/components/ui";
import { addCardDocument, removeCardDocument, setCardMissing } from "@/lib/card-actions";
import { CARD_CHECKLIST, type DocumentRow, type MissingCard } from "@/lib/doctor-flow";
import { MAX_UPLOAD_BYTES } from "@/lib/interview";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const BUCKET = "office-documents";

// Shown wherever cards are uploaded (doctor step 2, VFDA's rules page).
export function NoPatientInfoWarning() {
  return (
    <Notice tone="danger" role="note" title="No real patient information">
      <p>
        Before you export a card, remove real patient names, dates of birth, phone numbers, emails, addresses,
        insurance or card numbers, and screenshots of charts. Use made-up examples instead. Never include logins or
        passwords.
      </p>
    </Notice>
  );
}

// The card checklist: one row per Trello card, each with its uploaded PDFs,
// or "We don't have this card" (that topic then uses VFDA's standards).
export function CardUpload({ officeId, documents, missing = [] }: { officeId: string; documents: DocumentRow[]; missing?: MissingCard[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface [&>li:nth-child(even)]:bg-surface-zebra">
      {CARD_CHECKLIST.map((card) => (
        <CardRow
          key={card.name}
          officeId={officeId}
          name={card.name}
          note={card.note}
          documents={documents.filter((d) => d.card_name === card.name)}
          missing={missing.find((m) => m.card_name === card.name) ?? null}
        />
      ))}
    </ul>
  );
}

function CardRow({
  officeId,
  name,
  note,
  documents,
  missing,
}: {
  officeId: string;
  name: string;
  note: string;
  documents: DocumentRow[];
  missing: MissingCard | null;
}) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setBusy(true);
    const supabase = createBrowserSupabase();
    for (const file of Array.from(list)) {
      if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
        setError(`${file.name}: upload the card as a PDF.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is over 50 MB.`);
        continue;
      }
      const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${officeId}/cards/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: "application/pdf" });
      if (uploadError) {
        setError(`${file.name}: ${uploadError.message}`);
        continue;
      }
      const result = await addCardDocument(officeId, { path, name: file.name, cardName: name });
      if (!result.ok) {
        // Don't leave a file behind that no document points to.
        await supabase.storage.from(BUCKET).remove([path]);
        setError(`${file.name}: ${result.error}`);
      }
    }
    setBusy(false);
    router.refresh();
  }

  async function markMissing(value: boolean) {
    setError(null);
    setBusy(true);
    const result = await setCardMissing(officeId, name, value);
    if (!result.ok) setError(result.error);
    setBusy(false);
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const result = await removeCardDocument(officeId, id);
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          <span
            className={`mr-2 inline-block w-4 ${documents.length || missing ? "text-success" : "text-muted"}`}
            aria-label={documents.length ? "Uploaded" : missing ? "No card" : "Not uploaded"}
          >
            {documents.length || missing ? "✓" : "○"}
          </span>
          {name}
          {note && <span className="ml-2 text-sm font-normal text-muted">({note})</span>}
        </p>
        {missing ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">We don&apos;t have this card: VFDA standards are used</span>
            <button type="button" disabled={busy} onClick={() => markMissing(false)} className={buttonClass("ghost", "sm")}>
              Undo
            </button>
          </span>
        ) : (
          !documents.length && (
            <button
              type="button"
              disabled={busy}
              onClick={() => markMissing(true)}
              className={buttonClass("ghost", "sm")}
            >
              We don&apos;t have this card
            </button>
          )
        )}
        <label
          htmlFor={inputId}
          className={buttonClass("secondary", "sm", `cursor-pointer has-[+input:focus-visible]:outline-2 ${busy ? "pointer-events-none opacity-60" : ""}`)}
        >
          {busy ? "Uploading…" : documents.length ? "Add another PDF" : "Upload PDF"}
        </label>
        <input
          id={inputId}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {documents.length > 0 && (
        <ul className="ml-6 flex flex-col gap-1 text-sm">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">{d.file_name}</span>
              <ByLine verb="Uploaded" name={d.uploaded_by_name} at={d.created_at} />
              {d.imported_at ? (
                <span className="text-xs font-medium text-success">read ✓</span>
              ) : (
                <button type="button" onClick={() => remove(d.id)} className={buttonClass("danger", "sm")}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {missing && (
        <p className="ml-6">
          <ByLine verb="Marked" name={missing.marked_by_name} at={missing.marked_at} />
        </p>
      )}
      {error && <p className="ml-6 text-sm font-medium text-danger" role="alert">{error}</p>}
    </li>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { addCardDocument, removeCardDocument } from "@/lib/card-actions";
import { CARD_CHECKLIST, type DocumentRow } from "@/lib/doctor-flow";
import { MAX_UPLOAD_BYTES } from "@/lib/interview";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const BUCKET = "office-documents";

// Shown wherever cards are uploaded (doctor step 2, VFDA's rules page).
export function NoPatientInfoWarning() {
  return (
    <div
      role="note"
      className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      <p className="font-semibold">No real patient information</p>
      <p>
        Before you export a card, remove real patient names, dates of birth, phone numbers, emails, addresses,
        insurance or card numbers, and screenshots of charts. Use made-up examples instead. Never include logins or
        passwords.
      </p>
    </div>
  );
}

// The card checklist: one row per Trello card, each with its uploaded PDFs.
export function CardUpload({ officeId, documents }: { officeId: string; documents: DocumentRow[] }) {
  return (
    <ul className="flex flex-col divide-y divide-foreground/10 rounded-lg border border-foreground/15">
      {CARD_CHECKLIST.map((card) => (
        <CardRow
          key={card.name}
          officeId={officeId}
          name={card.name}
          note={card.note}
          documents={documents.filter((d) => d.card_name === card.name)}
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
}: {
  officeId: string;
  name: string;
  note: string;
  documents: DocumentRow[];
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

  async function remove(id: string) {
    setError(null);
    const result = await removeCardDocument(officeId, id);
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          <span
            className={`mr-2 inline-block w-4 ${documents.length ? "text-green-700 dark:text-green-400" : "text-foreground/30"}`}
            aria-label={documents.length ? "Uploaded" : "Not uploaded"}
          >
            {documents.length ? "✓" : "○"}
          </span>
          {name}
          {note && <span className="ml-2 text-sm font-normal text-foreground/60">({note})</span>}
        </p>
        <label
          htmlFor={inputId}
          className={`cursor-pointer rounded-lg border border-foreground/25 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 ${
            busy ? "pointer-events-none opacity-60" : ""
          }`}
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
              <span className="truncate">{d.file_name}</span>
              {d.imported_at ? (
                <span className="text-xs text-foreground/50">read</span>
              ) : (
                <button type="button" onClick={() => remove(d.id)} className="text-xs underline">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="ml-6 text-sm text-red-700 dark:text-red-400">{error}</p>}
    </li>
  );
}

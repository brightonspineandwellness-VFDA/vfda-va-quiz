"use client";

import { useId, useState } from "react";
import {
  blankMatrixRow,
  CHOICE_OPTIONS,
  MATRIX_COLUMNS,
  MAX_UPLOAD_BYTES,
  UPLOAD_BUCKET,
  type Attachment,
  type MatrixRow,
  type UploadValue,
} from "@/lib/interview";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export const inputClass =
  "w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm focus:border-foreground/50 focus:outline-none";
const smallButton =
  "rounded-md border border-foreground/20 px-2.5 py-1 text-sm hover:bg-foreground/5 disabled:opacity-50";
const removeButton = "shrink-0 rounded-md px-2 text-foreground/50 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950";

export function TextAnswer({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <textarea
      aria-label={label}
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} field-sizing-content min-h-16`}
    />
  );
}

export function OptionsAnswer({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm has-focus-visible:ring-2 ${
            value === o.value
              ? "border-foreground bg-foreground text-background"
              : "border-foreground/25 hover:border-foreground/50"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function choiceOptions(key: string) {
  return (CHOICE_OPTIONS[key] ?? []).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
}

// Editable lines, used for lists and links.
export function LinesAnswer({
  lines,
  onChange,
  placeholder,
  addLabel = "Add line",
  type = "text",
}: {
  lines: string[];
  onChange: (lines: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  type?: "text" | "url";
}) {
  const shown = lines.length ? lines : [""];
  const set = (i: number, v: string) => onChange(shown.map((l, j) => (j === i ? v : l)));
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((line, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type={type}
            value={line}
            placeholder={placeholder}
            aria-label={`${addLabel.replace(/^Add /, "")} ${i + 1}`}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onChange([...shown.slice(0, i + 1), "", ...shown.slice(i + 1)]);
              }
            }}
            className={inputClass}
          />
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onChange(shown.filter((_, j) => j !== i))}
            className={removeButton}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...shown, ""])} className={`${smallButton} self-start`}>
        + {addLabel}
      </button>
    </div>
  );
}

export function MatrixAnswer({ rows, onChange }: { rows: MatrixRow[]; onChange: (rows: MatrixRow[]) => void }) {
  const set = (i: number, key: string, v: string) =>
    onChange(rows.map((row, j) => (j === i ? { ...row, [key]: v } : row)));
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-foreground/15">
        <table className="min-w-[72rem] text-sm">
          <thead className="bg-foreground/5 text-left">
            <tr>
              {MATRIX_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="px-2 py-1.5 font-medium">
                  {c.label}
                </th>
              ))}
              <th className="w-8">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-foreground/10 align-top">
                {MATRIX_COLUMNS.map((c) => (
                  <td key={c.key} className="p-1">
                    <textarea
                      rows={1}
                      aria-label={`${row.visit_type || `Row ${i + 1}`}: ${c.label}`}
                      value={row[c.key] ?? ""}
                      onChange={(e) => set(i, c.key, e.target.value)}
                      className={`${inputClass} field-sizing-content px-2 py-1 ${c.key === "visit_type" ? "font-medium" : ""}`}
                    />
                  </td>
                ))}
                <td className="p-1">
                  <button
                    type="button"
                    aria-label={`Remove ${row.visit_type || "row"}`}
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    className={`${removeButton} py-1`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => onChange([...rows, blankMatrixRow()])} className={`${smallButton} self-start`}>
        + Add visit type
      </button>
    </div>
  );
}

export function UploadAnswer({
  value,
  onChange,
  files,
}: {
  value: UploadValue;
  onChange: (v: UploadValue) => void;
  files: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {files}
      <SubLabel text="Links (Loom, Google Doc…)">
        <LinesAnswer
          type="url"
          lines={value.links}
          onChange={(links) => onChange({ ...value, links })}
          placeholder="https://www.loom.com/share/…"
          addLabel="Add link"
        />
      </SubLabel>
      <SubLabel text="Or paste it here">
        <textarea
          rows={3}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          className={`${inputClass} field-sizing-content min-h-20`}
        />
      </SubLabel>
    </div>
  );
}

function SubLabel({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-foreground/60">{text}</p>
      {children}
    </div>
  );
}

// Uploads go straight from the browser to the private bucket, under the
// office's folder; storage policies only allow this office's doctor and VFDA.
export function FileUploads({
  officeId,
  folder,
  label,
  accept,
  files,
  urls,
  onAdded,
  onRemove,
}: {
  officeId: string;
  folder: string;
  label: string;
  accept: string;
  files: Attachment[];
  urls: Record<string, string>;
  onAdded: (file: Attachment, url: string | null) => Promise<string | null>;
  onRemove: (path: string) => Promise<string | null>;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setBusy(true);
    const supabase = createBrowserSupabase();
    for (const file of Array.from(list)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is over 50 MB. Upload it to Loom or Google Drive and add the link instead.`);
        continue;
      }
      const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${officeId}/${folder}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        setError(`${file.name}: ${uploadError.message}`);
        continue;
      }
      const { data } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrl(path, 3600);
      const problem = await onAdded({ path, name: file.name, size: file.size, type: file.type }, data?.signedUrl ?? null);
      if (problem) {
        // Don't leave a file behind that no answer points to.
        await supabase.storage.from(UPLOAD_BUCKET).remove([path]);
        setError(`${file.name}: ${problem}`);
      }
    }
    setBusy(false);
  }

  async function remove(path: string) {
    setError(null);
    const problem = await onRemove(path);
    if (problem) setError(problem);
  }

  return (
    <SubLabel text={label}>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-2">
              {urls[f.path] ? (
                <a href={urls[f.path]} target="_blank" rel="noreferrer" className="truncate underline">
                  {f.name}
                </a>
              ) : (
                <span className="truncate">{f.name}</span>
              )}
              <span className="shrink-0 text-xs text-foreground/50">{Math.ceil(f.size / 1024)} KB</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => remove(f.path)} className={removeButton}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <label htmlFor={inputId} className={`${smallButton} inline-block cursor-pointer ${busy ? "opacity-50" : ""}`}>
          {busy ? "Uploading…" : "+ Upload file"}
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          accept={accept}
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </SubLabel>
  );
}

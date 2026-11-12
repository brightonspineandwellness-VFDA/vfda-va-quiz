import { MATRIX_COLUMNS, type AnswerValue, type Attachment, type InterviewQuestion, type MatrixRow } from "@/lib/interview";

// Read-only display of one rule's value, shaped by its slot's answer type.
export function RuleValue({
  slot,
  value,
  attachments = [],
  fileUrls = {},
}: {
  slot: Pick<InterviewQuestion, "answer_type">;
  value: AnswerValue;
  attachments?: Attachment[];
  fileUrls?: Record<string, string>;
}) {
  if (value === null || value === undefined || value === "") {
    return <p className="text-muted">Not answered</p>;
  }
  if (typeof value === "string") {
    return <p className="whitespace-pre-line">{slot.answer_type === "yesno" ? (value === "yes" ? "Yes" : "No") : value}</p>;
  }
  if (Array.isArray(value) && slot.answer_type === "matrix") {
    const rows = value as MatrixRow[];
    return (
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
        <table className="w-full text-left text-sm [&_tbody_tr:nth-child(even)]:bg-surface-zebra">
          <thead className="bg-surface-muted">
            <tr>
              {MATRIX_COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-line align-top">
                {MATRIX_COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-2">
                    {row?.[c.key] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(value)) {
    const lines = (value as string[]).filter((l) => typeof l === "string" && l.trim());
    return lines.length ? (
      <ul className="list-disc pl-5">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    ) : (
      <p className="text-muted">Not answered</p>
    );
  }
  const upload = value as { text?: string; links?: string[] };
  const links = (upload.links ?? []).filter((l) => l.trim());
  return (
    <div className="flex flex-col gap-1">
      {upload.text?.trim() && <p className="whitespace-pre-line">{upload.text}</p>}
      {links.map((l) => (
        <a key={l} href={l} target="_blank" rel="noreferrer" className="break-all font-medium text-primary underline">
          {l}
        </a>
      ))}
      {attachments.map((f) =>
        fileUrls[f.path] ? (
          <a key={f.path} href={fileUrls[f.path]} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
            {f.name}
          </a>
        ) : (
          <span key={f.path}>{f.name}</span>
        ),
      )}
      {!upload.text?.trim() && links.length === 0 && attachments.length === 0 && (
        <p className="text-muted">Not answered</p>
      )}
    </div>
  );
}

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
    return <p className="text-foreground/50">Not answered</p>;
  }
  if (typeof value === "string") {
    return <p className="whitespace-pre-line">{slot.answer_type === "yesno" ? (value === "yes" ? "Yes" : "No") : value}</p>;
  }
  if (Array.isArray(value) && slot.answer_type === "matrix") {
    const rows = value as MatrixRow[];
    return (
      <div className="overflow-x-auto">
        <table className="text-left text-xs">
          <thead className="text-foreground/60">
            <tr>
              {MATRIX_COLUMNS.map((c) => (
                <th key={c.key} className="py-1 pr-3 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-foreground/10 align-top">
                {MATRIX_COLUMNS.map((c) => (
                  <td key={c.key} className="py-1 pr-3">
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
      <p className="text-foreground/50">Not answered</p>
    );
  }
  const upload = value as { text?: string; links?: string[] };
  const links = (upload.links ?? []).filter((l) => l.trim());
  return (
    <div className="flex flex-col gap-1">
      {upload.text?.trim() && <p className="whitespace-pre-line">{upload.text}</p>}
      {links.map((l) => (
        <a key={l} href={l} target="_blank" rel="noreferrer" className="break-all underline">
          {l}
        </a>
      ))}
      {attachments.map((f) =>
        fileUrls[f.path] ? (
          <a key={f.path} href={fileUrls[f.path]} target="_blank" rel="noreferrer" className="underline">
            {f.name}
          </a>
        ) : (
          <span key={f.path}>{f.name}</span>
        ),
      )}
      {!upload.text?.trim() && links.length === 0 && attachments.length === 0 && (
        <p className="text-foreground/50">Not answered</p>
      )}
    </div>
  );
}

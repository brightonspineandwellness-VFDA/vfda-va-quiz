"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DocumentRow } from "@/lib/doctor-flow";
import { updateCardMapping } from "@/lib/card-map-actions";

const COLOR_STYLES: Record<string, string> = {
  green: "bg-green-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  gray: "bg-gray-400",
  other: "bg-foreground/30",
};

// Every card PDF that has been read: what it's called, its color, the day(s)
// and workflow it feeds (suggested; VFDA can change it), or "skip".
export function CardMapping({
  documents,
  days,
  workflows,
}: {
  documents: DocumentRow[];
  days: { code: string; title: string }[];
  workflows: { code: string; name: string }[];
}) {
  const read = documents.filter((d) => d.imported_at);
  if (!read.length) return <p className="text-sm text-foreground/60">Cards show here once they&apos;ve been read.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {read.map((d) => (
        <CardRow key={d.id} doc={d} days={days} workflows={workflows} />
      ))}
    </ul>
  );
}

function CardRow({
  doc,
  days,
  workflows,
}: {
  doc: DocumentRow;
  days: { code: string; title: string }[];
  workflows: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(doc.schedule_days ?? []);
  const [workflow, setWorkflow] = useState(doc.workflow ?? "");
  const [skip, setSkip] = useState(!!doc.skip);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const changed =
    skip !== !!doc.skip ||
    workflow !== (doc.workflow ?? "") ||
    [...chosen].sort().join() !== [...(doc.schedule_days ?? [])].sort().join();

  return (
    <li className={`flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3 ${skip ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`inline-block size-3 self-center rounded-sm ${COLOR_STYLES[doc.card_color ?? ""] ?? "border border-foreground/30"}`}
          title={doc.card_color ?? "no color"}
        />
        <span className="font-medium">{doc.card_title || doc.file_name}</span>
        <span className="text-xs text-foreground/60">
          {doc.file_name} · uploaded as {doc.card_name}
          {doc.card_color ? ` · ${doc.card_color}` : ""}
          {(doc.tags ?? []).map((t) => ` · ${t.replace("_", "-")}`).join("")}
        </span>
        <span className="text-xs text-foreground/60">{doc.mapped_at ? "set by VFDA" : "suggested"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-foreground/60">Days:</span>
        {days.map((d) => (
          <label key={d.code} className="flex items-center gap-1" title={d.title}>
            <input
              type="checkbox"
              disabled={skip}
              checked={chosen.includes(d.code)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, d.code] : chosen.filter((c) => c !== d.code))}
            />
            {d.code}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Workflow
          <select
            value={workflow}
            disabled={skip}
            onChange={(e) => setWorkflow(e.target.value)}
            className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1"
          >
            <option value="">–</option>
            {workflows.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          Skip (no process content)
        </label>
        <button
          type="button"
          disabled={pending || !changed}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await updateCardMapping(doc.id, { days: skip ? [] : chosen, workflow: workflow || null, skip });
              if (!result.ok) setError(result.error);
              router.refresh();
            })
          }
          className="rounded-lg border border-foreground/25 px-3 py-1 font-medium hover:bg-foreground/5 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {error && <span className="text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </li>
  );
}

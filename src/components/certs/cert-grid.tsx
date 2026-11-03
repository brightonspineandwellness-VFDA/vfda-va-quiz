import Link from "next/link";
import { CERT_LABELS, SOP_LABELS } from "@/lib/certification";
import type { GridCell, GridRow } from "@/lib/certifications";
import { showDate } from "@/lib/va-flow";

const TONE: Record<string, string> = {
  certified: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  coaching: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

// VAs × workflows (the 10 standard ones, then the office's gray card
// workflows), with each workflow's status and Trello card link(s).
// `certificatePath` links the printable certificate. Nothing is assigned from
// here: VFDA decides the follow-up for Coaching needed.
export function CertGrid({
  columns,
  rows,
  certificatePath,
}: {
  columns: { code: string; name: string }[];
  rows: GridRow[];
  certificatePath?: (vaId: string) => string;
}) {
  if (!rows.length) return <p className="text-sm text-foreground/70">No VAs yet.</p>;
  const hasGray = rows.some((r) => r.cells.length > columns.length);
  return (
    <div className="overflow-x-auto">
      <table className="text-left text-xs">
        <thead className="border-b border-foreground/15 text-foreground/60">
          <tr>
            <th className="py-1 pr-3 font-medium">VA</th>
            {columns.map((c) => (
              <th key={c.code} className="py-1 pr-3 font-medium" title={c.name}>
                {c.code}
              </th>
            ))}
            {hasGray && <th className="py-1 pr-3 font-medium">Gray cards</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vaId} className="border-b border-foreground/10 align-top">
              <td className="py-2 pr-3">
                <span className="font-medium">{r.vaName}</span>
                <br />
                <span className="text-foreground/60">{r.officeName}</span>
                {r.allCertified && certificatePath && (
                  <>
                    <br />
                    <Link href={certificatePath(r.vaId)} className="underline">
                      Certificate
                    </Link>
                  </>
                )}
              </td>
              {r.cells.slice(0, columns.length).map((c) => (
                <td key={c.code} className="py-2 pr-3">
                  <Cell cell={c} />
                </td>
              ))}
              {hasGray && (
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-2">
                    {r.cells.slice(columns.length).map((c) => (
                      <div key={c.code}>
                        <span className="font-medium">
                          {c.code} {c.name}
                        </span>
                        <Cell cell={c} />
                      </div>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ cell }: { cell: GridCell }) {
  if (!cell.applies) return <span className="text-foreground/40">n/a</span>;
  if (!cell.status) return <span className="text-foreground/50">not yet</span>;
  return (
    <div className="flex min-w-24 flex-col gap-0.5">
      <span className={`self-start rounded px-1.5 py-0.5 font-medium ${TONE[cell.status]}`}>{CERT_LABELS[cell.status]}</span>
      {cell.links.map((l, i) => (
        <a key={l} href={l} target="_blank" rel="noreferrer" className="underline">
          Trello{cell.links.length > 1 ? ` ${i + 1}` : ""}
        </a>
      ))}
      {cell.status !== "certified" && cell.sopStatus && cell.submittedAt && (
        <span className="text-foreground/60">SOP: {SOP_LABELS[cell.sopStatus]}</span>
      )}
      {cell.status !== "certified" && !cell.submittedAt && <span className="text-foreground/60">card not updated</span>}
      {cell.recheckDate && <span className="text-foreground/60">recheck {showDate(cell.recheckDate)}</span>}
      {cell.openDrill && <span className="text-foreground/60">{cell.openDrill} open</span>}
    </div>
  );
}

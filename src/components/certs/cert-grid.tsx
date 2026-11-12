import Link from "next/link";
import { EmptyState, linkClass, StatusBadge, Table, td, th } from "@/components/ui";
import { CERT_LABELS, SOP_LABELS } from "@/lib/certification";
import type { GridCell, GridRow } from "@/lib/certifications";
import type { Tone } from "@/lib/theme";
import { showDate } from "@/lib/va-flow";

const TONE: Record<string, Tone> = {
  certified: "success",
  coaching: "danger",
  pending: "warning",
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
  if (!rows.length) return <EmptyState title="No VAs yet">Certifications show here once VAs start training.</EmptyState>;
  const hasGray = rows.some((r) => r.cells.length > columns.length);
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>VA</th>
          {columns.map((c) => (
            <th key={c.code} className={th} title={c.name}>
              {c.code}
            </th>
          ))}
          {hasGray && <th className={th}>Gray cards</th>}
        </tr>
      </thead>
      <tbody className="text-sm">
        {rows.map((r) => (
          <tr key={r.vaId}>
            <td className={td}>
              <span className="font-semibold">{r.vaName}</span>
              <br />
              <span className="text-muted">{r.officeName}</span>
              {r.allCertified && certificatePath && (
                <>
                  <br />
                  <Link href={certificatePath(r.vaId)} className={linkClass}>
                    Certificate
                  </Link>
                </>
              )}
            </td>
            {r.cells.slice(0, columns.length).map((c) => (
              <td key={c.code} className={td}>
                <Cell cell={c} />
              </td>
            ))}
            {hasGray && (
              <td className={td}>
                <div className="flex flex-col gap-2">
                  {r.cells.slice(columns.length).map((c) => (
                    <div key={c.code}>
                      <span className="font-semibold">
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
    </Table>
  );
}

function Cell({ cell }: { cell: GridCell }) {
  if (!cell.applies) return <span className="text-xs text-muted">n/a</span>;
  if (!cell.status) return <span className="text-xs text-muted">not yet</span>;
  return (
    <div className="flex min-w-24 flex-col gap-1 text-xs">
      <span className="self-start">
        <StatusBadge label={CERT_LABELS[cell.status]} tone={TONE[cell.status]} />
      </span>
      {cell.links.map((l, i) => (
        <a key={l} href={l} target="_blank" rel="noreferrer" className={linkClass}>
          Trello{cell.links.length > 1 ? ` ${i + 1}` : ""}
        </a>
      ))}
      {cell.status !== "certified" && cell.sopStatus && cell.submittedAt && (
        <span className="text-muted">SOP: {SOP_LABELS[cell.sopStatus]}</span>
      )}
      {cell.status !== "certified" && !cell.submittedAt && <span className="text-muted">card not updated</span>}
      {cell.recheckDate && <span className="text-muted">recheck {showDate(cell.recheckDate)}</span>}
      {cell.openDrill && <span className="text-muted">{cell.openDrill} open</span>}
      {cell.retakeNote && <span className="text-muted">{cell.retakeNote}</span>}
    </div>
  );
}

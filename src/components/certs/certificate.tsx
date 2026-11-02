import type { ReactNode } from "react";
import type { GridRow } from "@/lib/certifications";
import { showDate } from "@/lib/va-flow";
import { PrintButton } from "@/components/certs/print-button";

// The printable certificate, once every one of the office's workflows is Certified.
export function Certificate({ row, back }: { row: GridRow; back: ReactNode }) {
  const workflows = row.cells.filter((c) => c.applies);
  if (!row.allCertified) {
    return (
      <>
        {back}
        <p>
          The certificate is ready once every one of {row.officeName}&apos;s workflows is Certified (
          {workflows.filter((c) => c.status === "certified").length} of {workflows.length} so far).
        </p>
      </>
    );
  }
  const issued = workflows.map((c) => c.certifiedAt ?? "").sort().at(-1) ?? "";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        {back}
        <PrintButton />
      </div>
      <article className="flex flex-col items-center gap-4 rounded-lg border-4 border-double border-foreground/40 px-8 py-10 text-center print:border-black">
        <p className="text-sm tracking-widest text-foreground/60 uppercase">Certificate of completion</p>
        <h1 className="text-3xl font-semibold">{row.vaName}</h1>
        <p>
          has completed VA training for <span className="font-semibold">{row.officeName}</span> and is certified on every workflow:
        </p>
        <table className="text-left text-sm">
          <tbody>
            {workflows.map((c) => (
              <tr key={c.code}>
                <td className="py-0.5 pr-4 font-medium">{c.code}</td>
                <td className="py-0.5 pr-4">{c.name}</td>
                <td className="py-0.5 text-foreground/60">
                  {c.certifiedAt ? `certified ${showDate(c.certifiedAt.slice(0, 10))}` : ""}
                  {c.recheckDate ? ` · recheck ${showDate(c.recheckDate)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-foreground/70">Issued {issued ? showDate(issued.slice(0, 10)) : ""} · VFDA</p>
      </article>
    </>
  );
}

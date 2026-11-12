import type { ReactNode } from "react";
import type { GridRow } from "@/lib/certifications";
import { showDate } from "@/lib/va-flow";
import { PrintButton } from "@/components/certs/print-button";
import { Logo } from "@/components/signed-in-page";
import { Notice } from "@/components/ui";

// The printable certificate, once every one of the office's workflows is Certified.
export function Certificate({ row, back }: { row: GridRow; back: ReactNode }) {
  const workflows = row.cells.filter((c) => c.applies);
  if (!row.allCertified) {
    return (
      <>
        {back}
        <Notice tone="info" title="Certificate not ready yet">
          <p>
            The certificate is ready once every one of {row.officeName}&apos;s workflows is Certified (
            {workflows.filter((c) => c.status === "certified").length} of {workflows.length} so far).
          </p>
        </Notice>
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
      {/* Always white (the logo is a JPG on white), on screen and on paper. */}
      <article className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border-4 border-double border-[#1E2A6B] bg-white px-4 py-10 text-center text-[#1F2937] shadow-[0_1px_2px_rgba(16,24,40,0.06)] sm:px-8 print:border-black print:shadow-none">
        <Logo height={56} />
        <p className="text-sm tracking-widest text-[#5B6472] uppercase">Certificate of completion</p>
        <h1 className="text-3xl font-semibold text-[#1E2A6B]">{row.vaName}</h1>
        <p className="max-w-prose">
          has completed VA training for <span className="font-semibold">{row.officeName}</span> and is certified on every workflow
          of their role{row.scope !== "All roles" ? ` (${row.scope})` : ""}:
        </p>
        <div className="w-full max-w-xl overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {workflows.map((c) => (
                <tr key={c.code} className="border-t border-[#DCE1E8]">
                  <td className="py-1.5 pr-4 font-semibold">{c.code}</td>
                  <td className="py-1.5 pr-4">{c.name}</td>
                  <td className="py-1.5 text-[#5B6472]">
                    {c.certifiedAt ? `certified ${showDate(c.certifiedAt.slice(0, 10))}` : ""}
                    {c.recheckDate ? ` · recheck ${showDate(c.recheckDate)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-[#5B6472]">
          Issued {issued ? showDate(issued.slice(0, 10)) : ""}
          {row.primaryDoctor && ` · ${row.primaryDoctor}, ${row.officeName}`} · VFDA
        </p>
      </article>
    </>
  );
}

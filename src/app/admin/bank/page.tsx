import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { EmptyState, NumberBadge, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getLibraryOverview } from "@/lib/library";
import { BankText } from "./bank-text";

export default function LibraryPage() {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="Library"
        description="VFDA's 10 standard workflows and the master scenario bank (read-only)."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Library" }]}
      />
      <Suspense fallback={<Loading />}>
        <LibraryOverview />
      </Suspense>
    </SignedInPage>
  );
}

async function LibraryOverview() {
  await requireRole("vfda_admin");
  const { workflows, scenarioCount, bankInfo } = await getLibraryOverview();

  if (workflows.length === 0) {
    return (
      <EmptyState title="The library is empty">
        Run <code>npm run import:bank</code> on your computer.
      </EmptyState>
    );
  }

  return (
    <>
      <p className="text-muted">
        {workflows.length} standard workflows · {scenarioCount} scenarios
        {bankInfo?.version ? ` · bank version ${bankInfo.version}` : ""} · read-only
      </p>
      <ol className="flex flex-col gap-3">
        {workflows.map((wf, n) => (
          <li key={wf.id}>
            <Link
              href={`/admin/bank/${wf.code}`}
              className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-colors hover:border-primary sm:px-5"
            >
              <NumberBadge n={n + 1} />
              <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="font-semibold text-primary">
                  <span className="font-mono">{wf.code}</span> · {wf.name}
                </p>
                <p className="text-sm text-muted">
                  {wf.scenarioCount} scenarios · {wf.steps.length} steps · {wf.rule_keys.length} office rules
                </p>
              </div>
              <p className="mt-1 text-sm text-foreground">
                <BankText text={wf.trigger} />
              </p>
              {wf.byDay.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {wf.byDay.map((d) => (
                    <li key={d.code} className="rounded-full border border-line bg-surface-muted px-2 py-0.5" title={d.title}>
                      <span className="font-mono">{d.code}</span> {d.count}
                    </li>
                  ))}
                </ul>
              )}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

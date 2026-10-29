import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { getLibraryOverview } from "@/lib/library";
import { BankText } from "./bank-text";

export default function LibraryPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">Library</h1>
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
      <p className="rounded-lg border border-foreground/15 px-4 py-3">
        The library is empty. Run <code>npm run import:bank</code> on your computer.
      </p>
    );
  }

  return (
    <>
      <p className="text-foreground/70">
        {workflows.length} standard workflows · {scenarioCount} scenarios
        {bankInfo?.version ? ` · bank version ${bankInfo.version}` : ""} · read-only
      </p>
      <ol className="flex flex-col gap-3">
        {workflows.map((wf) => (
          <li key={wf.id}>
            <Link
              href={`/admin/bank/${wf.code}`}
              className="block rounded-lg border border-foreground/15 px-4 py-3 hover:border-foreground/40"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="font-medium">
                  <span className="font-mono">{wf.code}</span> · {wf.name}
                </p>
                <p className="text-sm text-foreground/60">
                  {wf.scenarioCount} scenarios · {wf.steps.length} steps · {wf.rule_keys.length} office rules
                </p>
              </div>
              <p className="mt-1 text-sm text-foreground/80">
                <BankText text={wf.trigger} />
              </p>
              {wf.byDay.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {wf.byDay.map((d) => (
                    <li key={d.code} className="rounded bg-foreground/5 px-1.5 py-0.5" title={d.title}>
                      <span className="font-mono">{d.code}</span> {d.count}
                    </li>
                  ))}
                </ul>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

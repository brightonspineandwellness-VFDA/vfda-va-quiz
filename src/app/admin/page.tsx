import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

export default function AdminPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <AdminHome />
      </Suspense>
    </SignedInPage>
  );
}

function Tile({ href, title, detail, count }: { href: string; title: string; detail: string; count?: number }) {
  return (
    <Link
      href={href}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-colors hover:border-primary hover:bg-primary-soft"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold text-primary">{title}</span>
        {count !== undefined && <span className="text-2xl font-semibold tabular-nums text-foreground">{count}</span>}
      </span>
      <span className="text-sm text-muted">{detail}</span>
    </Link>
  );
}

async function AdminHome() {
  const user = await requireRole("vfda_admin");
  const supabase = await createSessionClient();
  const [{ count }, { count: sops }] = await Promise.all([
    supabase.from("offices").select("id", { count: "exact", head: true }),
    supabase
      .from("certifications")
      .select("id", { count: "exact", head: true })
      .eq("sop_status", "pending")
      .not("sop_submitted_at", "is", null),
  ]);

  return (
    <>
      <PageHeader title={`Welcome, ${user.fullName || user.email}`} description="Offices, VA progress and the VFDA library, all in one place." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile href="/admin/offices" title="Offices" detail="Setup, cards, rules and scenarios for each office" count={count ?? 0} />
        <Tile href="/admin/vas" title="VA progress" detail="Scores, flags, certifications, proof of work" />
        <Tile href="/admin/reports" title="Reports" detail="Every finished quiz: doctor and VA reports, delivery status" />
        <Tile href="/admin/sops" title="SOPs to confirm" detail="SOPs VAs have submitted for review" count={sops ?? 0} />
        <Tile href="/admin/logs" title="System log" detail="Scenario checks" />
        <Tile href="/admin/bank" title="Library" detail="The 10 standard workflows and the master bank" />
        <Tile href="/admin/settings" title="Settings" detail="Grading mode, report test sends" />
      </div>
    </>
  );
}

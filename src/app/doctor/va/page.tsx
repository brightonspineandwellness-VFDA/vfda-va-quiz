import Link from "next/link";
import { Suspense } from "react";
import { AttemptLink, ReportPdfLink } from "@/components/attempts/attempt-review";
import { CertGrid } from "@/components/certs/cert-grid";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { loadCertGrid } from "@/lib/certifications";
import { createSessionClient } from "@/lib/supabase/server";
import { attemptLabel, percentOf, resultLabel } from "@/lib/va-flow";

export default function MyVaPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor" className="text-sm text-foreground/60 hover:underline">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold">My VA</h1>
      <p className="text-sm text-foreground/70">
        Each workflow&apos;s status, with the Trello card your VA updated for it. Review and approve cards on Trello; VFDA records
        your approval here.
      </p>
      <Suspense fallback={<Loading />}>
        <Grid />
      </Suspense>
    </SignedInPage>
  );
}

// Read-only, own office only.
async function Grid() {
  const user = await requireRole("doctor");
  if (!user.officeId) return <p>Your account isn&apos;t linked to an office yet.</p>;
  const supabase = await createSessionClient();
  const [{ columns, rows }, attempts, vas] = await Promise.all([
    loadCertGrid(supabase, { officeId: user.officeId }),
    // Row-level security: this office's VAs only. Archived (test) attempts don't count.
    supabase
      .from("attempts")
      .select("id, va_id, kind, schedule_day, submitted_at, first_try_points, max_points, result")
      .eq("office_id", user.officeId)
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("office_id", user.officeId).eq("role", "va"),
  ]);
  const nameOf = new Map((vas.data ?? []).map((v) => [v.id, v.full_name || v.email || "VA"]));
  return (
    <>
      <CertGrid columns={columns} rows={rows} certificatePath={(id) => `/doctor/va/${id}/certificate`} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-foreground/70">
        {columns.map((c) => (
          <div key={c.code} className="contents">
            <dt className="font-medium">{c.code}</dt>
            <dd>{c.name}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Quiz reports</h2>
        {(attempts.data ?? []).length === 0 ? (
          <p className="text-sm text-foreground/70">No quizzes finished yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {(attempts.data ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-foreground/10 pb-2">
                <span className="font-medium">{nameOf.get(a.va_id) ?? "VA"}</span>
                <span>{attemptLabel(a)}</span>
                <span>
                  {resultLabel(a.result)} · {Number(a.first_try_points)}/{a.max_points} ({percentOf(a.first_try_points, a.max_points)}%)
                </span>
                <span className="text-foreground/60">{new Date(a.submitted_at!).toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
                <AttemptLink id={a.id} area="doctor" />
                <ReportPdfLink attemptId={a.id} area="doctor" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

import { Suspense } from "react";
import { AttemptLink, ReportPdfLink } from "@/components/attempts/attempt-review";
import { CertGrid } from "@/components/certs/cert-grid";
import { StandardsNotice } from "@/components/reports/standards";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, td, tdNum, th, thNum } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadCertGrid } from "@/lib/certifications";
import { attemptStandards } from "@/lib/quiz-reports";
import { standardsUsed } from "@/lib/rule-source";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { attemptLabel, percentOf, resultLabel } from "@/lib/va-flow";

// The VFDA standards notice covers the latest reports (each one is checked item by item).
const NOTICE_REPORTS = 10;

export default function MyVaPage() {
  return (
    <SignedInPage area="Doctor">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "My VA" }]}
        title="My VA"
        description="Each workflow's status, with the Trello card your VA updated for it. Review and approve cards on Trello; VFDA records your approval here."
      />
      <Suspense fallback={<Loading />}>
        <Grid />
      </Suspense>
    </SignedInPage>
  );
}

// Read-only, own office only.
async function Grid() {
  const user = await requireRole("doctor");
  if (!user.officeId) return <EmptyState title="Your account isn't linked to an office yet.">VFDA will set this up.</EmptyState>;
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
  const list = attempts.data ?? [];
  // Which reports relied on a VFDA standard (the attempts were read as the doctor above).
  const db = createAdminClient();
  const latest = list.slice(0, NOTICE_REPORTS);
  const checked = await Promise.all(latest.map((a) => attemptStandards(db, a.id)));
  const usesStandards = new Set(latest.filter((_, n) => checked[n].standards.length).map((a) => a.id));
  const standards = standardsUsed(checked.map((c) => (c.standards.length ? { kind: "vfda_standard" as const, card: null, rules: c.standards } : null)));

  return (
    <>
      <Card title="Workflows">
        <CertGrid columns={columns} rows={rows} certificatePath={(id) => `/doctor/va/${id}/certificate`} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-muted">
          {columns.map((c) => (
            <div key={c.code} className="contents">
              <dt className="font-semibold text-foreground">{c.code}</dt>
              <dd>{c.name}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <StandardsNotice rules={standards} audience="doctor" />

      <Card title="Quiz reports" description="Open a report to see every answer, or download the PDF.">
        {list.length === 0 ? (
          <EmptyState title="No quizzes finished yet">Reports show here as soon as your VA finishes a training day.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>VA</th>
                <th className={th}>Quiz</th>
                <th className={th}>Result</th>
                <th className={thNum}>First try</th>
                <th className={th}>Date</th>
                <th className={th}>Report</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} font-medium`}>{nameOf.get(a.va_id) ?? "VA"}</td>
                  <td className={td}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {attemptLabel(a)}
                      {usesStandards.has(a.id) && <Badge tone="info">VFDA standard</Badge>}
                    </span>
                  </td>
                  <td className={td}>
                    <StatusBadge label={resultLabel(a.result)} />
                  </td>
                  <td className={tdNum}>
                    {Number(a.first_try_points)}/{a.max_points} ({percentOf(a.first_try_points, a.max_points)}%)
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{new Date(a.submitted_at!).toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
                  <td className={td}>
                    <span className="flex flex-wrap items-center gap-3">
                      <AttemptLink id={a.id} area="doctor" />
                      <ReportPdfLink attemptId={a.id} area="doctor" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

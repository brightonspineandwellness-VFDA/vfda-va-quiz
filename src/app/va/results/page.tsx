import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, ButtonLink, Card, EmptyState, linkClass, PageHeader, StatusBadge, Table, td, tdNum, th, thNum } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { CERT_LABELS, SOP_LABELS } from "@/lib/certification";
import { loadCertGrid } from "@/lib/certifications";
import { createAdminClient } from "@/lib/supabase/server";
import { attemptLabel, percentOf, resultLabel, showDate, todayIn } from "@/lib/va-flow";

const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";

export default function ResultsPage() {
  return (
    <SignedInPage area="VA">
      <PageHeader
        title="My results"
        description="Every finished quiz with its report and coaching tips, and where each workflow stands."
        breadcrumbs={[{ label: "Today", href: "/va" }, { label: "My results" }]}
      />
      <Suspense fallback={<Loading />}>
        <Results />
      </Suspense>
    </SignedInPage>
  );
}

// Where each workflow stands, and every finished quiz with its report (My
// report): first-try score, result label, RETAKE. Read on the server for this
// VA only; never scenarios, answers or answer keys.
async function Results() {
  const user = await requireRole("va");
  const db = createAdminClient();
  const [{ data: attempts }, { data: days }, grid] = await Promise.all([
    db
      .from("attempts")
      .select("id, schedule_day, kind, submitted_at, first_try_points, max_points, result")
      .eq("va_id", user.id)
      .eq("office_id", user.officeId ?? "")
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at", { ascending: false }),
    db.from("schedule_days").select("code, title"),
    loadCertGrid(db, { vaIds: [user.id] }),
  ]);
  const done = attempts ?? [];
  const titleOf = new Map((days ?? []).map((d) => [d.code, d.title as string]));
  const row = grid.rows[0];

  return (
    <>
      <Card title="My quizzes">
        {!done.length ? (
          <EmptyState title="No finished quizzes yet">Your scores and coaching tips show up here after your first quiz.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Quiz</th>
                <th className={th}>Date</th>
                <th className={thNum}>Score</th>
                <th className={th}>Result</th>
                <th className={th}>
                  <span className="sr-only">Report</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {done.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} min-w-48`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {a.kind === "day" || a.kind === "retake" ? a.schedule_day : attemptLabel(a)}
                        {(a.kind === "day" || a.kind === "retake") && titleOf.get(a.schedule_day) && `: ${titleOf.get(a.schedule_day)}`}
                      </span>
                      {a.kind === "retake" && <Badge tone="accent">Retake</Badge>}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{showDate(todayIn(TIME_ZONE, new Date(a.submitted_at!)))}</td>
                  <td className={`${tdNum} whitespace-nowrap`}>
                    {Number(a.first_try_points ?? 0)}/{a.max_points ?? 0} ({percentOf(a.first_try_points, a.max_points)}%)
                  </td>
                  <td className={td}>{a.result ? <StatusBadge label={resultLabel(a.result)} /> : <span className="text-muted">–</span>}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Link href={`/va/results/${a.id}`} className={linkClass}>
                      My report →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card
        title="Workflows"
        actions={
          row?.allCertified ? (
            <ButtonLink href="/va/certificate" variant="primary" size="sm">
              Your certificate
            </ButtonLink>
          ) : undefined
        }
      >
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {(row?.cells ?? [])
            .filter((c) => c.applies)
            .map((c) => (
              <li key={c.code} className="flex flex-col gap-1 px-4 py-3 text-[0.9375rem]">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {c.code} {c.name}
                  </span>
                  {c.status ? <StatusBadge label={CERT_LABELS[c.status]} tone={c.status === "coaching" ? "warning" : undefined} /> : <Badge>Not reached yet</Badge>}
                  {c.status === "certified" && c.recheckDate && <span className="text-sm text-muted">recheck {showDate(c.recheckDate)}</span>}
                  {c.status !== "certified" && c.submittedAt && c.sopStatus && (
                    <span className="text-sm text-muted">Trello card: {SOP_LABELS[c.sopStatus]}</span>
                  )}
                </span>
                {c.sopNote && c.status !== "certified" && <span className="text-sm text-muted">VFDA: {c.sopNote}</span>}
                {c.retakeNote && <span className="text-sm text-muted">{c.retakeNote}</span>}
              </li>
            ))}
        </ul>
      </Card>
    </>
  );
}

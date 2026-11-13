import Link from "next/link";
import { Suspense } from "react";
import { ReportButtons } from "@/components/reports/report-buttons";
import { SendReport } from "@/components/reports/send-report";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, ButtonLink, buttonClass, Card, EmptyState, linkClass, PageHeader, StatusBadge, Table, td, tdNum, th, thNum } from "@/components/ui";
import { MAX_ROWS, loadReportRows, parseFilters, type Delivery, type ReportFilters } from "@/lib/admin-reports";
import { requireRole } from "@/lib/auth";
import { oldLabelHint, RESULT_LABELS, showDate, todayIn } from "@/lib/va-flow";

const TIME_ZONE = process.env.TRAINING_TIME_ZONE || "America/New_York";

// "Send report" sends while you wait.
export const maxDuration = 120;

export default function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="Reports"
        description="Every finished quiz, newest first: score, label, flags and where its report went. Open the doctor/VFDA PDF or the VA's own report, or send it again."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Reports" }]}
      />
      <Suspense fallback={<Loading />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </SignedInPage>
  );
}

const DELIVERY_TONE: Record<Delivery, "success" | "danger" | "warning" | "neutral"> = {
  sent: "success",
  failed: "danger",
  sending: "warning",
  "not sent": "neutral",
};

function DeliveryLine({ name, status }: { name: string; status: Delivery }) {
  return (
    <span className="flex items-center justify-between gap-2 whitespace-nowrap">
      <span className="text-muted">{name}</span>
      <Badge tone={DELIVERY_TONE[status]}>{status}</Badge>
    </span>
  );
}

async function Reports({ searchParams }: { searchParams: PageProps<"/admin/reports">["searchParams"] }) {
  await requireRole("vfda_admin");
  const filters = parseFilters(await searchParams);
  const { rows, capped, options } = await loadReportRows(filters);
  const active = Object.values(filters).some(Boolean);

  return (
    <>
      <Filters filters={filters} options={options} />

      <Card
        title={`${rows.length} report${rows.length === 1 ? "" : "s"}`}
        description={capped ? `Showing the newest ${MAX_ROWS}. Narrow the filters to see older ones.` : undefined}
      >
        {!rows.length ? (
          <EmptyState title={active ? "No reports match these filters" : "No finished quizzes yet"}>
            {active ? (
              <Link href="/admin/reports" className={linkClass}>
                Clear the filters
              </Link>
            ) : (
              "Reports show up here as VAs finish their quizzes."
            )}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Office · VA</th>
                <th className={th}>Day</th>
                <th className={thNum}>Score</th>
                <th className={th}>Label</th>
                <th className={thNum}>Critical</th>
                <th className={th}>Flags</th>
                <th className={th}>Delivery</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap`}>{showDate(todayIn(TIME_ZONE, new Date(r.submittedAt)))}</td>
                  <td className={`${td} min-w-40`}>
                    <span className="flex flex-col">
                      <span className="font-medium">{r.vaName}</span>
                      <span className="text-sm text-muted">{r.officeName}</span>
                    </span>
                  </td>
                  <td className={`${td} min-w-44`}>
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/attempts/${r.id}`} className={linkClass}>
                          {r.day}
                        </Link>
                        {r.retake && <Badge tone="accent">RETAKE</Badge>}
                      </span>
                      {r.topic && <span className="text-sm text-muted">{r.topic}</span>}
                    </span>
                  </td>
                  <td className={`${tdNum} whitespace-nowrap`}>
                    {r.points}/{r.max}
                  </td>
                  <td className={td}>
                    <StatusBadge label={r.label} hint={oldLabelHint(r.result)} />
                  </td>
                  <td className={tdNum}>{r.criticalErrors > 0 ? <Badge tone="danger">{r.criticalErrors}</Badge> : <span className="text-muted">0</span>}</td>
                  <td className={`${td} text-sm`}>{r.flags.length ? r.flags.join(", ") : <span className="text-muted">–</span>}</td>
                  <td className={`${td} text-sm`}>
                    <span className="flex min-w-40 flex-col gap-1" title={r.errors.join("\n") || undefined}>
                      <DeliveryLine name="VFDA email" status={r.delivery.email} />
                      <DeliveryLine name="Slack" status={r.delivery.slack} />
                      <DeliveryLine name="Leads4Life" status={r.delivery.leads4life} />
                    </span>
                  </td>
                  <td className={td}>
                    <span className="flex flex-col items-start gap-2">
                      <ReportButtons attemptId={r.id} area="admin" compact />
                      <SendReport attemptId={r.id} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="text-sm text-muted">
          Delivery is the latest send of each report (the automatic one, or the last &quot;Send report&quot;). Hover a row&apos;s delivery to see why
          a send failed.
        </p>
      </Card>
    </>
  );
}

// A plain GET form: the filters live in the address, so a filtered list can be bookmarked or shared.
function Filters({
  filters,
  options,
}: {
  filters: ReportFilters;
  options: Awaited<ReturnType<typeof loadReportRows>>["options"];
}) {
  const label = "flex flex-col gap-1 text-sm font-semibold";
  return (
    <Card title="Filters">
      <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={label}>
          Office
          <select name="office" defaultValue={filters.office ?? ""}>
            <option value="">All offices</option>
            {options.offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          VA
          <select name="va" defaultValue={filters.va ?? ""}>
            <option value="">All VAs</option>
            {options.vas.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Day
          <select name="day" defaultValue={filters.day ?? ""}>
            <option value="">All days</option>
            {options.days.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code}: {d.title}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Label
          <select name="label" defaultValue={filters.label ?? ""}>
            <option value="">All labels</option>
            {Object.entries(RESULT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          From
          <input type="date" name="from" defaultValue={filters.from ?? ""} />
        </label>
        <label className={label}>
          To
          <input type="date" name="to" defaultValue={filters.to ?? ""} />
        </label>
        <span className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="critical" value="1" defaultChecked={filters.critical} />
            Has critical error
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="failed" value="1" defaultChecked={filters.failed} />
            Delivery failed
          </label>
        </span>
        <span className="flex items-end gap-2">
          <button type="submit" className={buttonClass("primary")}>
            Apply
          </button>
          <ButtonLink href="/admin/reports">Clear</ButtonLink>
        </span>
      </form>
    </Card>
  );
}

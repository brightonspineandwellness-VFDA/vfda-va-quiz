import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ButtonAnchor, Card, EmptyState, linkClass, PageHeader, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { itemLines, reportBlocks, reportCounts, type OfficeReportContent } from "@/lib/office-report";
import { regenerateOfficeReport, resendOfficeReport } from "@/lib/office-report-actions";
import { createSessionClient } from "@/lib/supabase/server";

// "Write a new report" waits while Claude compares the cards.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASONS: Record<string, string> = {
  review: "after VFDA's review",
  reimport: "after new cards were read",
  manual: "written on demand",
};

type ReportRow = {
  id: string;
  reason: string;
  content: OfficeReportContent;
  created_at: string;
  emailed_at: string | null;
  email_error: string | null;
  slack_at: string | null;
  slack_error: string | null;
};

export default function OfficeReportPage({ params, searchParams }: PageProps<"/admin/offices/[id]/report">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <OfficeReport params={params} searchParams={searchParams} />
      </Suspense>
    </SignedInPage>
  );
}

// The office SOP gap report: VFDA only (row-level security), never the doctor.
async function OfficeReport({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("vfda_admin");
  const { id } = await params;
  const { r } = await searchParams;
  if (!UUID.test(id)) notFound();
  const supabase = await createSessionClient();
  const [{ data: office }, { data: rows }] = await Promise.all([
    supabase.from("offices").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("office_reports")
      .select("id, reason, content, created_at, emailed_at, email_error, slack_at, slack_error")
      .eq("office_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (!office) notFound();
  const reports = (rows ?? []) as ReportRow[];
  const report = (typeof r === "string" && reports.find((x) => x.id === r)) || reports[0];
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader
        title={`Office SOP gap report: ${office.name}`}
        description="VFDA only; the doctor never sees this. The office's cards against the VFDA standards and the 10 workflows."
        breadcrumbs={[
          { label: "Offices", href: "/admin/offices" },
          { label: office.name, href: `/admin/offices/${id}` },
          { label: "SOP gap report" },
        ]}
        actions={
          <>
            {report && (
              <ButtonAnchor href={`/admin/offices/${id}/report/pdf?r=${report.id}`} variant="primary" download>
                Download PDF
              </ButtonAnchor>
            )}
            <ActionButton
              action={regenerateOfficeReport.bind(null, id)}
              label={report ? "Write a new report" : "Write the report"}
              pendingLabel="Comparing the cards (about a minute)…"
            />
          </>
        }
      />

      {!report ? (
        <EmptyState title="No report yet">It&apos;s written each time the office&apos;s cards are read.</EmptyState>
      ) : (
        <>
          <Status report={report} when={when} />
          <Report content={report.content} />
          {reports.length > 1 && (
            <Card title="Earlier reports">
              <ul className="flex flex-col gap-1 text-sm">
                {reports.map((x) => {
                  const n = reportCounts(x.content);
                  return (
                    <li key={x.id}>
                      {x.id === report.id ? (
                        <span className="font-semibold">{when(x.created_at)}</span>
                      ) : (
                        <Link href={`/admin/offices/${id}/report?r=${x.id}`} className={linkClass}>
                          {when(x.created_at)}
                        </Link>
                      )}{" "}
                      · {REASONS[x.reason] ?? x.reason} · {n.safety} safety, {n.missing} missing, {n.conflicts} conflicts, {n.partial}{" "}
                      partial
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function Status({ report, when }: { report: ReportRow; when: (iso: string) => string }) {
  const failed = !!report.email_error || !!report.slack_error;
  return (
    <Card title="Status">
      <p className="text-sm text-muted">
        {when(report.created_at)} · {REASONS[report.reason] ?? report.reason}
        {report.content.method === "claude" ? " · steps checked by Claude" : " · steps checked by word matching"}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Email to VFDA:{" "}
        {report.emailed_at ? (
          <StatusBadge label={`Sent ${when(report.emailed_at)}`} tone="success" />
        ) : (
          <StatusBadge label={report.email_error ?? "Not sent"} tone="danger" />
        )}
        <span className="text-muted">·</span> Slack:{" "}
        {report.slack_at ? (
          <StatusBadge label={`Posted ${when(report.slack_at)}`} tone="success" />
        ) : (
          <StatusBadge label={report.slack_error ?? "Not posted"} tone="danger" />
        )}
      </p>
      {failed && (
        <div>
          <ActionButton action={resendOfficeReport.bind(null, report.id)} label="Send again" pendingLabel="Sending…" />
        </div>
      )}
    </Card>
  );
}

// The same blocks as the email and the PDF.
function Report({ content }: { content: OfficeReportContent }) {
  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-5 shadow-[0_1px_2px_rgba(16,24,40,0.06)] sm:px-6">
      {reportBlocks(content).map((b, i) => {
        switch (b.type) {
          case "title":
            return null;
          case "heading":
            return (
              <h2 key={i} className="mt-4 border-b border-line pb-1.5 text-lg font-semibold first:mt-0">
                {b.text}
              </h2>
            );
          case "subheading":
            return (
              <h3 key={i} className="mt-2 font-semibold text-foreground">
                {b.text}
              </h3>
            );
          case "muted":
            return (
              <p key={i} className="text-sm text-muted">
                {b.text}
              </p>
            );
          case "text":
            return <p key={i}>{b.text}</p>;
          case "item": {
            const l = itemLines(b.item, b.high);
            return (
              <div
                key={i}
                className={`flex flex-col gap-1 rounded-[var(--radius-card)] border border-l-4 px-3 py-2.5 text-sm ${
                  b.high ? "border-danger bg-danger-soft" : "border-line-strong bg-surface-muted"
                }`}
              >
                <p className={`font-semibold ${b.high ? "text-danger" : ""}`}>{l.title}</p>
                <div className={`grid gap-2 ${l.office ? "md:grid-cols-2" : ""}`}>
                  <p className="whitespace-pre-wrap">{l.vfda}</p>
                  {l.office && <p className="whitespace-pre-wrap">{l.office}</p>}
                </div>
                {l.quotes.map((q) => (
                  <p key={q} className="text-muted italic">
                    {q}
                  </p>
                ))}
                <p className="text-muted">{l.note}</p>
              </div>
            );
          }
        }
      })}
    </article>
  );
}

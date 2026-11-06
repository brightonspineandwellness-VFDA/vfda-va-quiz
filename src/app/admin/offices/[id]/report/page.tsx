import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
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
      <Link href={`/admin/offices/${id}`} className="text-sm text-foreground/60 hover:underline">
        ← {office.name}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Office SOP gap report: {office.name}</h1>
        <p className="text-sm text-foreground/60">
          VFDA only; the doctor never sees this. The office&apos;s cards against the VFDA standards and the 10 workflows.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {report && (
          <a
            href={`/admin/offices/${id}/report/pdf?r=${report.id}`}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            download
          >
            Download PDF
          </a>
        )}
        <ActionButton
          action={regenerateOfficeReport.bind(null, id)}
          label={report ? "Write a new report" : "Write the report"}
          pendingLabel="Comparing the cards (about a minute)…"
        />
      </div>

      {!report ? (
        <p className="text-foreground/70">
          No report yet. It&apos;s written when VFDA finishes reviewing the office&apos;s card rules (Send to doctor), and
          again after new cards are read.
        </p>
      ) : (
        <>
          <Status report={report} when={when} />
          <Report content={report.content} />
          {reports.length > 1 && (
            <section className="flex flex-col gap-1 border-t border-foreground/10 pt-4 text-sm">
              <h2 className="text-lg font-semibold">Earlier reports</h2>
              <ul className="flex flex-col gap-1">
                {reports.map((x) => {
                  const n = reportCounts(x.content);
                  return (
                    <li key={x.id}>
                      {x.id === report.id ? (
                        <span className="font-medium">{when(x.created_at)}</span>
                      ) : (
                        <Link href={`/admin/offices/${id}/report?r=${x.id}`} className="underline">
                          {when(x.created_at)}
                        </Link>
                      )}{" "}
                      · {REASONS[x.reason] ?? x.reason} · {n.safety} safety, {n.missing} missing, {n.conflicts} conflicts, {n.partial}{" "}
                      partial
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Status({ report, when }: { report: ReportRow; when: (iso: string) => string }) {
  const failed = !!report.email_error || !!report.slack_error;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-foreground/70">
        {when(report.created_at)} · {REASONS[report.reason] ?? report.reason}
        {report.content.method === "claude" ? " · steps checked by Claude" : " · steps checked by word matching"}
      </p>
      <p>
        Email to VFDA:{" "}
        {report.emailed_at ? `sent ${when(report.emailed_at)}` : <span className="text-red-700 dark:text-red-400">{report.email_error ?? "not sent"}</span>}
        {" · "}Slack:{" "}
        {report.slack_at ? `posted ${when(report.slack_at)}` : <span className="text-red-700 dark:text-red-400">{report.slack_error ?? "not posted"}</span>}
      </p>
      {failed && <ActionButton action={resendOfficeReport.bind(null, report.id)} label="Send again" pendingLabel="Sending…" />}
    </div>
  );
}

// The same blocks as the email and the PDF.
function Report({ content }: { content: OfficeReportContent }) {
  return (
    <article className="flex flex-col gap-2">
      {reportBlocks(content).map((b, i) => {
        switch (b.type) {
          case "title":
            return null;
          case "heading":
            return (
              <h2 key={i} className="mt-4 text-xl font-semibold">
                {b.text}
              </h2>
            );
          case "subheading":
            return (
              <h3 key={i} className="mt-2 font-semibold text-foreground/80">
                {b.text}
              </h3>
            );
          case "muted":
            return (
              <p key={i} className="text-sm text-foreground/60">
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
                className={`flex flex-col gap-1 rounded-md border-l-4 px-3 py-2 text-sm ${
                  b.high ? "border-red-600 bg-red-50 dark:bg-red-950/40" : "border-foreground/20 bg-foreground/5"
                }`}
              >
                <p className={`font-medium ${b.high ? "text-red-800 dark:text-red-300" : ""}`}>{l.title}</p>
                <div className={`grid gap-2 ${l.office ? "md:grid-cols-2" : ""}`}>
                  <p className="whitespace-pre-wrap">{l.vfda}</p>
                  {l.office && <p className="whitespace-pre-wrap">{l.office}</p>}
                </div>
                {l.quotes.map((q) => (
                  <p key={q} className="text-foreground/70 italic">
                    {q}
                  </p>
                ))}
                <p className="text-foreground/60">{l.note}</p>
              </div>
            );
          }
        }
      })}
    </article>
  );
}

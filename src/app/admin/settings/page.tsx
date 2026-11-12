import { Suspense } from "react";
import { TestButton } from "@/components/settings/test-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Card, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { aiMode } from "@/lib/ai";
import { requireRole } from "@/lib/auth";
import { appUrl, reportFrom, vfdaEmails } from "@/lib/reports";
import { testEmail, testLeads4Life, testSlack } from "@/lib/va-admin-actions";
import { runVaReportBackfill } from "@/lib/va-report-actions";

// A test send can take two tries; Backfill VA reports asks Claude for each attempt.
export const maxDuration = 300;

export default function SettingsPage() {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="Settings"
        description="Grading mode, email and webhook setup, VA report backfill and test sends."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Settings" }]}
      />
      <Suspense fallback={<Loading />}>
        <Settings />
      </Suspense>
    </SignedInPage>
  );
}

// Shows whether each setting is there, never its value (keys are secret).
async function Settings() {
  await requireRole("vfda_admin");
  const isSet = (name: string) => !!process.env[name]?.trim();
  const rows: [string, string][] = [
    ["AI_MODE", aiMode() === "mock" ? "mock (answers graded by keywords, not Claude)" : "live (Claude)"],
    ["ANTHROPIC_API_KEY", isSet("ANTHROPIC_API_KEY") ? "set" : "missing"],
    ["RESEND_API_KEY", isSet("RESEND_API_KEY") ? "set" : "missing"],
    ["REPORT_FROM_EMAIL", reportFrom() || "missing"],
    ["REPORT_REPLY_TO", process.env.REPORT_REPLY_TO?.trim() || "not set (optional)"],
    ["VFDA_REPORT_EMAIL", vfdaEmails().join(", ") || "missing"],
    ["SLACK_WEBHOOK_URL", isSet("SLACK_WEBHOOK_URL") ? "set" : "missing"],
    ["LEADS4LIFE_WEBHOOK_URL", isSet("LEADS4LIFE_WEBHOOK_URL") ? "set" : "missing (doctors get no quiz reports)"],
    ["Links in reports", appUrl()],
  ];
  return (
    <>
      <Card number={1} title="Grading and reports" description="Change these in Vercel (and .env.local), then redeploy.">
        <Table>
          <thead>
            <tr>
              <th className={th}>Setting</th>
              <th className={th}>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className={`${td} font-mono text-sm text-muted`}>{k}</td>
                <td className={`${td} break-words`}>
                  {v.startsWith("missing") ? <StatusBadge label={v} tone="danger" /> : v === "set" ? <StatusBadge label="set" tone="success" /> : v}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card number={2} title="VA reports">
        <p className="text-sm text-muted">
          Every finished attempt without a VA report gets one: coaching tips written by Claude, shown on the VA&apos;s My results
          at once. Then each VA gets ONE email listing all their new reports. Safe to run again: a report is never made twice
          and a report is never emailed twice. Skips deactivated VAs, and attempts graded in mock mode (listed on the System
          log).
        </p>
        <TestButton action={runVaReportBackfill} label="Backfill VA reports" pendingLabel="Writing reports… (a few minutes)" />
      </Card>
      <Card number={3} title="Test sends">
        <TestButton action={testEmail} label="Send a test email to VFDA" />
        <TestButton action={testSlack} label="Post a test message to Slack" />
        <TestButton action={testLeads4Life} label="Send test to Leads4Life" />
        <p className="text-sm text-muted">
          The Leads4Life test sends a sample report (Dr. Test, brightonspineandwellness+doctortest@gmail.com) with a real 30-day
          link to a sample PDF, and shows Leads4Life&apos;s answer.
        </p>
      </Card>
    </>
  );
}

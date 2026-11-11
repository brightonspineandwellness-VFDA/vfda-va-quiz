import Link from "next/link";
import { Suspense } from "react";
import { TestButton } from "@/components/settings/test-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
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
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">Settings</h1>
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
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Grading and reports</h2>
        <p className="text-sm text-foreground/70">Change these in Vercel (and .env.local), then redeploy.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-foreground/60">{k}</dt>
              <dd className={v.startsWith("missing") ? "text-red-700 dark:text-red-400" : ""}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">VA reports</h2>
        <p className="text-sm text-foreground/70">
          Every finished attempt without a VA report gets one: coaching tips written by Claude, shown on the VA&apos;s My results
          at once. Then each VA gets ONE email listing all their new reports. Safe to run again: a report is never made twice
          and a report is never emailed twice. Skips deactivated VAs, and attempts graded in mock mode (listed on the System
          log).
        </p>
        <TestButton action={runVaReportBackfill} label="Backfill VA reports" pendingLabel="Writing reports… (a few minutes)" />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Test sends</h2>
        <TestButton action={testEmail} label="Send a test email to VFDA" />
        <TestButton action={testSlack} label="Post a test message to Slack" />
        <TestButton action={testLeads4Life} label="Send test to Leads4Life" />
        <p className="text-xs text-foreground/60">
          The Leads4Life test sends a sample report (Dr. Test, brightonspineandwellness+doctortest@gmail.com) with a real 30-day
          link to a sample PDF, and shows Leads4Life&apos;s answer.
        </p>
      </section>
    </>
  );
}

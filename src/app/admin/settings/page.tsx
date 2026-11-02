import Link from "next/link";
import { Suspense } from "react";
import { TestButton } from "@/components/settings/test-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { aiMode } from "@/lib/ai";
import { requireRole } from "@/lib/auth";
import { appUrl, reportFrom, vfdaEmails } from "@/lib/reports";
import { testEmail, testSlack } from "@/lib/va-admin-actions";

// A test send can take two tries.
export const maxDuration = 60;

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
        <h2 className="text-lg font-semibold">Test sends</h2>
        <TestButton action={testEmail} label="Send a test email to VFDA" />
        <TestButton action={testSlack} label="Post a test message to Slack" />
      </section>
    </>
  );
}

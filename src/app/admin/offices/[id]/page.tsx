import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InviteDoctorForm } from "@/components/doctors/invite-doctor";
import { TestButton } from "@/components/settings/test-button";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, ButtonLink, Card, EmptyState, linkClass, PageHeader, StatusBadge } from "@/components/ui";
import { InviteVaForm, MoveVaForm } from "@/components/va/invite-va";
import { VaScopeForm } from "@/components/va/va-scope";
import { StartDateForm } from "@/components/va/proof-review";
import { requireRole } from "@/lib/auth";
import { removeDoctorAction, resendDoctorLinkAction, setPrimaryDoctorAction } from "@/lib/doctor-invite-actions";
import { loadOfficeDoctors } from "@/lib/doctor-invites";
import { createSessionClient } from "@/lib/supabase/server";
import { showDate } from "@/lib/va-flow";
import { regradeOfficeAction } from "@/lib/va-admin-actions";
import { resendVaLinkAction, setVaActiveAction } from "@/lib/va-invite-actions";
import { loadOfficeVas, VA_STATUS_LABELS, type VaStatus } from "@/lib/va-invites";
import { nextTrainingDay } from "@/lib/va-training";

// "Re-grade with new rubric" grades every finished quiz again while you wait.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TONE: Record<VaStatus, "info" | "primary" | "success" | "neutral"> = {
  invited: "info",
  training: "primary",
  certified: "success",
  deactivated: "neutral",
};

export default function OfficePage({ params }: PageProps<"/admin/offices/[id]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <Office params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Office({ params }: { params: PageProps<"/admin/offices/[id]">["params"] }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createSessionClient();
  const [{ data: office }, { data: offices }] = await Promise.all([
    supabase.from("offices").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("offices").select("id, name").neq("id", id).order("name"),
  ]);
  if (!office) notFound();
  const [vas, doctors] = await Promise.all([loadOfficeVas(id), loadOfficeDoctors(id)]);
  const primary = doctors.find((d) => d.primary);
  const defaultStart = nextTrainingDay();

  return (
    <>
      <PageHeader
        title={office.name}
        description={
          <>
            Primary doctor: {primary?.name ?? "—"}
            {doctors.length > 1 && ` · ${doctors.length} doctors`}
          </>
        }
        breadcrumbs={[{ label: "Offices", href: "/admin/offices" }, { label: office.name }]}
      />
      <nav aria-label="Office pages" className="flex flex-wrap gap-2">
        <ButtonLink href={`/admin/offices/${id}/rules`} size="sm">
          Cards &amp; rules
        </ButtonLink>
        <ButtonLink href={`/admin/offices/${id}/interview`} size="sm">
          Standards &amp; must-ask rules
        </ButtonLink>
        <ButtonLink href={`/admin/offices/${id}/scenarios`} size="sm">
          Scenarios
        </ButtonLink>
        <ButtonLink href={`/admin/offices/${id}/bank`} size="sm">
          Scenario bank (answers)
        </ButtonLink>
        <ButtonLink href={`/admin/offices/${id}/report`} size="sm">
          SOP gap report (VFDA only)
        </ButtonLink>
      </nav>

      <Card
        number={1}
        title="Doctors"
        description="Every doctor has their own login and sees the same office: setup, VAs, results and certifications. Reports and alerts go to all of them. The Primary doctor is shown on the office, certificates and reports."
      >
        {doctors.length === 0 ? (
          <EmptyState title="No doctors yet">Invite the office&apos;s doctor below.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {doctors.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-sm text-muted">{d.email}</span>
                  {d.primary && <Badge tone="success">Primary</Badge>}
                  <span className="text-xs text-muted">
                    {d.lastSignIn ? `last signed in ${showDate(d.lastSignIn.slice(0, 10))}` : "hasn't signed in yet"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!d.primary && <ActionButton action={setPrimaryDoctorAction.bind(null, id, d.id)} label="Make primary" />}
                  <ActionButton action={resendDoctorLinkAction.bind(null, id, d.id)} label="Send sign-in link" pendingLabel="Sending…" />
                  {doctors.length > 1 && <ActionButton action={removeDoctorAction.bind(null, id, d.id)} label="Remove from office" pendingLabel="Removing…" />}
                </div>
              </li>
            ))}
          </ul>
        )}
        <InviteDoctorForm officeId={id} />
      </Card>

      <Card
        number={2}
        title="VAs"
        description="Moving a VA starts their training again at the new office; what they did here stays with this office."
        actions={
          <Link href="/admin/vas" className={`${linkClass} text-sm`}>
            VA progress
          </Link>
        }
      >
        {vas.length === 0 ? (
          <EmptyState title="No VAs yet">Invite the office&apos;s VA below.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {vas.map((va) => (
              <li key={va.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{va.name}</span>
                  <span className="text-sm text-muted">{va.email}</span>
                  <StatusBadge label={VA_STATUS_LABELS[va.status]} tone={TONE[va.status]} />
                  <span className="text-xs text-muted">
                    {va.lastSignIn ? `last signed in ${showDate(va.lastSignIn.slice(0, 10))}` : "hasn't signed in yet"}
                  </span>
                </div>
                {va.status === "deactivated" ? (
                  <div>
                    <ActionButton action={setVaActiveAction.bind(null, va.id, true)} label="Reactivate" />
                  </div>
                ) : (
                  <>
                    <StartDateForm vaId={va.id} value={va.startDate} />
                    <VaScopeForm vaId={va.id} scope={va.scope} />
                    <MoveVaForm vaId={va.id} offices={offices ?? []} defaultStart={defaultStart} />
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        action={resendVaLinkAction.bind(null, va.id)}
                        label="Send sign-in link"
                        pendingLabel="Sending…"
                      />
                      <ActionButton action={setVaActiveAction.bind(null, va.id, false)} label="Deactivate" />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <InviteVaForm officeId={id} defaultStart={defaultStart} />
      </Card>

      <Card
        number={3}
        title="Re-grade with new rubric"
        description="Scores every finished quiz of this office again with the current, more encouraging rubric (safety checks unchanged), then rebuilds each VA report and PDF. No emails, Slack posts or Leads4Life sends. Quizzes already on the new rubric are skipped; a big office may need a second press."
      >
        <TestButton action={regradeOfficeAction.bind(null, id)} label="Re-grade with new rubric" pendingLabel="Re-grading… (this takes a few minutes)" />
      </Card>
    </>
  );
}

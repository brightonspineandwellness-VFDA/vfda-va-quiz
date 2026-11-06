import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InviteDoctorForm } from "@/components/doctors/invite-doctor";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { InviteVaForm, MoveVaForm } from "@/components/va/invite-va";
import { VaScopeForm } from "@/components/va/va-scope";
import { StartDateForm } from "@/components/va/proof-review";
import { requireRole } from "@/lib/auth";
import { removeDoctorAction, resendDoctorLinkAction, setPrimaryDoctorAction } from "@/lib/doctor-invite-actions";
import { loadOfficeDoctors } from "@/lib/doctor-invites";
import { createSessionClient } from "@/lib/supabase/server";
import { showDate } from "@/lib/va-flow";
import { resendVaLinkAction, setVaActiveAction } from "@/lib/va-invite-actions";
import { loadOfficeVas, VA_STATUS_LABELS, type VaStatus } from "@/lib/va-invites";
import { nextTrainingDay } from "@/lib/va-training";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TONE: Record<VaStatus, string> = {
  invited: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  training: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  certified: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  deactivated: "bg-foreground/10 text-foreground/60",
};

export default function OfficePage({ params }: PageProps<"/admin/offices/[id]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/offices" className="text-sm text-foreground/60 hover:underline">
        ← Offices
      </Link>
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
      <div>
        <h1 className="text-2xl font-semibold">{office.name}</h1>
        <p className="text-sm text-foreground/60">
          Primary doctor: {primary?.name ?? "—"}
          {doctors.length > 1 && ` · ${doctors.length} doctors`}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
          <Link href={`/admin/offices/${id}/rules`} className="underline">
            Cards &amp; rules
          </Link>
          <Link href={`/admin/offices/${id}/interview`} className="underline">
            Standards &amp; must-ask rules
          </Link>
          <Link href={`/admin/offices/${id}/scenarios`} className="underline">
            Scenarios
          </Link>
          <Link href={`/admin/offices/${id}/report`} className="underline">
            SOP gap report (VFDA only)
          </Link>
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Doctors</h2>
        <p className="text-sm text-foreground/60">
          Every doctor has their own login and sees the same office: setup, VAs, results and certifications. Reports and
          alerts go to all of them. The Primary doctor is shown on the office, certificates and reports.
        </p>
        {doctors.length === 0 ? (
          <p className="text-sm text-foreground/70">No doctors yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {doctors.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-sm text-foreground/60">{d.email}</span>
                  {d.primary && (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                      Primary
                    </span>
                  )}
                  <span className="text-xs text-foreground/60">
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
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">VAs</h2>
          <Link href="/admin/vas" className="text-sm underline">
            VA progress
          </Link>
        </div>
        <p className="text-sm text-foreground/60">
          Moving a VA starts their training again at the new office; what they did here stays with this office.
        </p>
        {vas.length === 0 ? (
          <p className="text-sm text-foreground/70">No VAs yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {vas.map((va) => (
              <li key={va.id} className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{va.name}</span>
                  <span className="text-sm text-foreground/60">{va.email}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TONE[va.status]}`}>{VA_STATUS_LABELS[va.status]}</span>
                  <span className="text-xs text-foreground/60">
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
      </section>
    </>
  );
}

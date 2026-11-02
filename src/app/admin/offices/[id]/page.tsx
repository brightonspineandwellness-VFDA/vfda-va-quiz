import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { InviteVaForm, MoveVaForm } from "@/components/va/invite-va";
import { StartDateForm } from "@/components/va/proof-review";
import { requireRole } from "@/lib/auth";
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
  const [{ data: office }, { data: doctors }, { data: offices }] = await Promise.all([
    supabase.from("offices").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("full_name, email").eq("role", "doctor").eq("office_id", id),
    supabase.from("offices").select("id, name").neq("id", id).order("name"),
  ]);
  if (!office) notFound();
  const vas = await loadOfficeVas(id);
  const defaultStart = nextTrainingDay();

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{office.name}</h1>
        <p className="text-sm text-foreground/60">
          Doctor: {doctors?.length ? doctors.map((d) => d.full_name || d.email).join(", ") : "—"}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
          <Link href={`/admin/offices/${id}/rules`} className="underline">
            Cards &amp; rules
          </Link>
          <Link href={`/admin/offices/${id}/interview`} className="underline">
            Every rule slot
          </Link>
          <Link href={`/admin/offices/${id}/scenarios`} className="underline">
            Scenarios
          </Link>
        </p>
      </div>

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
                    {va.lastSignIn ? `last signed in ${showDate(va.lastSignIn)}` : "hasn't signed in yet"}
                  </span>
                </div>
                {va.status === "deactivated" ? (
                  <div>
                    <ActionButton action={setVaActiveAction.bind(null, va.id, true)} label="Reactivate" />
                  </div>
                ) : (
                  <>
                    <StartDateForm vaId={va.id} value={va.startDate} />
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

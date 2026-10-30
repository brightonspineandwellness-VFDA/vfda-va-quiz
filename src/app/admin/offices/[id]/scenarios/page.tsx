import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AutoRefresh, BuildAllButton } from "@/components/scenarios/scenario-controls";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { approveDay, buildDay, reopenDay } from "@/lib/scenario-actions";
import { dayState, KIND_LABELS, TONES } from "@/components/scenarios/day-state";
import { loadScenarioOverview } from "@/lib/scenario-data";

// Build buttons start the build after the response is sent.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ScenariosPage({ params }: PageProps<"/admin/offices/[id]/scenarios">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/offices" className="text-sm text-foreground/60 hover:underline">
        ← Offices
      </Link>
      <Suspense fallback={<Loading />}>
        <Scenarios params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Scenarios({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadScenarioOverview(id);
  if (!data) notFound();
  const { office, days } = data;
  const running = days.some((d) => d.status?.build_status === "running");
  const toBuild = days.filter((d) => !d.started && !d.status?.approved_at && d.status?.build_status !== "running");
  const approved = days.filter((d) => d.status?.approved_at).length;

  return (
    <>
      <AutoRefresh active={running} />
      <div>
        <h1 className="text-2xl font-semibold">Scenarios: {office.name}</h1>
        <p className="text-sm text-foreground/60">
          {approved} of {days.length} days approved
        </p>
      </div>
      <p className="text-sm text-foreground/70">
        Building fills every rule placeholder with the office&apos;s accepted rules and has Claude write the rest:
        options built from a rule, version B for retakes, a repeat variant for each situational item, gray card items
        and a skipped day&apos;s phone drills. Review each day, edit anything, then approve it. A day opens to VAs only
        once it&apos;s approved. Rebuilding replaces the day, including your edits.
      </p>
      <BuildAllButton officeId={office.id} days={toBuild.map((d) => d.code)} />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-foreground/15 text-foreground/60">
            <tr>
              <th className="py-2 pr-3 font-medium">Day</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Scenarios</th>
              <th className="py-2 pr-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const state = dayState(d);
              const built = d.status?.build_status === "done";
              return (
                <tr key={d.code} className="border-b border-foreground/10 align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/admin/offices/${office.id}/scenarios/${d.code}`} className="font-medium underline">
                      {d.code}: {d.title}
                    </Link>
                    <p className="text-foreground/60">{KIND_LABELS[d.kind]}</p>
                  </td>
                  <td className={`py-2 pr-3 ${TONES[state.tone]}`}>
                    {state.label}
                    {d.started && <p className="text-foreground/60">A VA has started this day</p>}
                  </td>
                  <td className="py-2 pr-3">
                    {built ? `${d.countA} (version B: ${d.countB}, repeats: ${d.repeats})` : "–"}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      {!d.started && !d.status?.approved_at && d.status?.build_status !== "running" && (
                        <ActionButton
                          action={buildDay.bind(null, office.id, d.code)}
                          label={built || d.status?.build_status === "failed" ? "Rebuild" : "Build"}
                          pendingLabel="Starting…"
                        />
                      )}
                      {built && !d.status?.approved_at && (
                        <ActionButton action={approveDay.bind(null, office.id, d.code)} label="Approve day" primary />
                      )}
                      {d.status?.approved_at && !d.started && (
                        <ActionButton action={reopenDay.bind(null, office.id, d.code)} label="Reopen" />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

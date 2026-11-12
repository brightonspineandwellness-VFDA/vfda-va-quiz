import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AutoRefresh, BuildAllButton } from "@/components/scenarios/scenario-controls";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Card, EmptyState, linkClass, PageHeader, Table, td, tdNum, th, thNum } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { approveDay, buildDay, reopenDay } from "@/lib/scenario-actions";
import { dayState, KIND_LABELS, statePillClass } from "@/components/scenarios/day-state";
import { loadScenarioOverview, rebuildNote } from "@/lib/scenario-data";

// Build buttons start the build after the response is sent.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ScenariosPage({ params }: PageProps<"/admin/offices/[id]/scenarios">) {
  return (
    <SignedInPage area="VFDA admin">
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
  const toBuild = days.filter((d) => !d.approved && d.status?.build_status !== "running");
  const approved = days.filter((d) => d.approved).length;

  return (
    <>
      <AutoRefresh active={running} />
      <PageHeader
        title={`Scenarios: ${office.name}`}
        description={`${approved} of ${days.length} days approved`}
        breadcrumbs={[
          { label: "Offices", href: "/admin/offices" },
          { label: office.name, href: `/admin/offices/${office.id}` },
          { label: "Scenarios" },
        ]}
      />
      <Card title="How days are built">
        <p className="text-sm text-muted">
          Card-first: Claude writes each day from the office&apos;s own cards mapped to it, with the master day as the
          pattern (same number of items) and the VFDA standards where the cards are silent, keeping the{" "}
          <Link href="/admin/logs" className={linkClass}>
            day rules
          </Link>{" "}
          (which cards, item types and topics each day may have). Every item shows the card and the card&apos;s words it
          came from, plus the repeat variant a VA gets right after a situational answer below 2/2 (describe items have
          none). A day with no card mapped is built from the master bank. Map cards on the{" "}
          <Link href={`/admin/offices/${office.id}/rules`} className={linkClass}>
            Cards page
          </Link>
          . Review each day, edit anything, then approve it. A day opens to VAs only once it&apos;s approved. Every
          rebuild is a new version (your edits stay on the old one): VAs who already took a version keep it, and new
          attempts get the new version once you approve it.
        </p>
        <BuildAllButton officeId={office.id} days={toBuild.map((d) => d.code)} />
      </Card>

      {days.length === 0 ? (
        <EmptyState title="No training days yet">The office&apos;s training days show here once they&apos;re set up.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Day</th>
              <th className={th}>Status</th>
              <th className={thNum}>Scenarios</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const state = dayState(d);
              const built = d.status?.build_status === "done";
              return (
                <tr key={d.code}>
                  <td className={td}>
                    <Link href={`/admin/offices/${office.id}/scenarios/${d.code}`} className={linkClass}>
                      {d.code}: {d.title}
                    </Link>
                    <p className="text-sm text-muted">{KIND_LABELS[d.kind]}</p>
                    <p className="text-xs text-muted">
                      {d.kind === "skipped" ? "" : d.cards.length ? `From: ${d.cards.join(", ")}` : "No card mapped: master bank"}
                    </p>
                  </td>
                  <td className={td}>
                    <span className={statePillClass(state.tone)}>{state.label}</span>
                    {rebuildNote(d) && <p className="mt-1 text-sm text-muted">{rebuildNote(d)}</p>}
                  </td>
                  <td className={tdNum}>{built ? `${d.countA} (repeats: ${d.repeats})` : "–"}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-2">
                      {d.status?.build_status !== "running" && (
                        <ActionButton
                          action={buildDay.bind(null, office.id, d.code)}
                          label={built || d.status?.build_status === "failed" ? "Rebuild" : "Build"}
                          pendingLabel="Starting…"
                        />
                      )}
                      {built && !d.approved && <ActionButton action={approveDay.bind(null, office.id, d.code)} label="Approve day" primary />}
                      {d.approved && !d.liveTaken && <ActionButton action={reopenDay.bind(null, office.id, d.code)} label="Reopen" />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}

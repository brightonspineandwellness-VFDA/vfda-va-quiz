import { Suspense } from "react";
import { SopDecision } from "@/components/certs/sop-decision";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { EmptyState, linkClass, PageHeader, StatusBadge, Table, td, tdNum, th, thNum } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { daysBetween, SOP_WAIT_FLAG_DAYS } from "@/lib/certification";
import { createSessionClient } from "@/lib/supabase/server";
import { showDate } from "@/lib/va-flow";

export default function SopsPage() {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="SOPs to confirm"
        description="Each office's Trello board is its SOP. Open the card, check the doctor approved it on Trello, then record it here."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "SOPs to confirm" }]}
      />
      <Suspense fallback={<Loading />}>
        <Sops />
      </Suspense>
    </SignedInPage>
  );
}

async function Sops() {
  await requireRole("vfda_admin");
  const supabase = await createSessionClient();
  const { data: certs } = await supabase
    .from("certifications")
    .select("id, va_id, office_id, workflow, office_workflow_id, sop_links, sop_link, sop_submitted_at, sop_note")
    .eq("sop_status", "pending")
    .not("sop_submitted_at", "is", null)
    .order("sop_submitted_at");
  if (!certs?.length) return <EmptyState title="Nothing waiting">Links appear here when a VA says a card is updated.</EmptyState>;

  const [vas, offices, workflows, gray] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", [...new Set(certs.map((c) => c.va_id))]),
    supabase.from("offices").select("id, name"),
    supabase.from("workflows").select("code, name"),
    supabase.from("office_workflows").select("id, code, name, card_answers"),
  ]);
  const vaOf = new Map((vas.data ?? []).map((v) => [v.id, v]));
  const officeName = new Map((offices.data ?? []).map((o) => [o.id, o.name]));
  const wfName = new Map((workflows.data ?? []).map((w) => [w.code, w.name]));
  const grayOf = new Map((gray.data ?? []).map((g) => [g.id, g]));
  const now = new Date();

  return (
    <Table>
        <thead>
          <tr>
            <th className={th}>VA</th>
            <th className={th}>Office</th>
            <th className={th}>Workflow</th>
            <th className={th}>Trello</th>
            <th className={th}>Submitted</th>
            <th className={thNum}>Waiting</th>
            <th className={th}>Decision</th>
          </tr>
        </thead>
        <tbody>
          {certs.map((c) => {
            const va = vaOf.get(c.va_id);
            const g = c.office_workflow_id ? grayOf.get(c.office_workflow_id) : null;
            const code = c.workflow ?? g?.code ?? "";
            const name = c.workflow ? (wfName.get(c.workflow) ?? "") : g?.name || String((g?.card_answers as Record<string, unknown>)?.CARD_NAME ?? "");
            const links: string[] = c.sop_links?.length ? c.sop_links : c.sop_link ? [c.sop_link] : [];
            const waiting = daysBetween(c.sop_submitted_at, now);
            return (
              <tr key={c.id}>
                <td className={td}>{va?.full_name || va?.email}</td>
                <td className={td}>{officeName.get(c.office_id) ?? "–"}</td>
                <td className={td}>
                  {code} {name}
                </td>
                <td className={td}>
                  <div className="flex flex-col">
                    {links.map((l, i) => (
                      <a key={l} href={l} target="_blank" rel="noreferrer" className={linkClass}>
                        Card{links.length > 1 ? ` ${i + 1}` : ""}
                      </a>
                    ))}
                  </div>
                </td>
                <td className={td}>{showDate(c.sop_submitted_at.slice(0, 10))}</td>
                <td className={tdNum}>
                  {waiting > SOP_WAIT_FLAG_DAYS ? (
                    <StatusBadge label={`${waiting} day${waiting === 1 ? "" : "s"}`} tone="danger" />
                  ) : (
                    <>
                      {waiting} day{waiting === 1 ? "" : "s"}
                    </>
                  )}
                </td>
                <td className={td}>
                  <SopDecision certificationId={c.id} />
                </td>
              </tr>
            );
          })}
        </tbody>
    </Table>
  );
}

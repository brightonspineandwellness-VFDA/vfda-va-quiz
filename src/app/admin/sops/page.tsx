import Link from "next/link";
import { Suspense } from "react";
import { SopDecision } from "@/components/certs/sop-decision";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { daysBetween, SOP_WAIT_FLAG_DAYS } from "@/lib/certification";
import { createSessionClient } from "@/lib/supabase/server";
import { showDate } from "@/lib/va-flow";

export default function SopsPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">SOPs to confirm</h1>
      <p className="text-sm text-foreground/70">
        Each office&apos;s Trello board is its SOP. Open the card, check the doctor approved it on Trello, then record it here.
      </p>
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
    .select("id, va_id, workflow, office_workflow_id, sop_links, sop_link, sop_submitted_at, sop_note")
    .eq("sop_status", "pending")
    .not("sop_submitted_at", "is", null)
    .order("sop_submitted_at");
  if (!certs?.length) return <p>Nothing waiting. Links appear here when a VA says a card is updated.</p>;

  const [vas, offices, workflows, gray] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, office_id").in("id", [...new Set(certs.map((c) => c.va_id))]),
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
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-foreground/15 text-foreground/60">
          <tr>
            <th className="py-1 pr-3 font-medium">VA</th>
            <th className="py-1 pr-3 font-medium">Office</th>
            <th className="py-1 pr-3 font-medium">Workflow</th>
            <th className="py-1 pr-3 font-medium">Trello</th>
            <th className="py-1 pr-3 font-medium">Submitted</th>
            <th className="py-1 pr-3 font-medium">Waiting</th>
            <th className="py-1 pr-3 font-medium">Decision</th>
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
              <tr key={c.id} className="border-b border-foreground/10 align-top">
                <td className="py-2 pr-3">{va?.full_name || va?.email}</td>
                <td className="py-2 pr-3">{va?.office_id ? officeName.get(va.office_id) : "–"}</td>
                <td className="py-2 pr-3">
                  {code} {name}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-col">
                    {links.map((l, i) => (
                      <a key={l} href={l} target="_blank" rel="noreferrer" className="underline">
                        Card{links.length > 1 ? ` ${i + 1}` : ""}
                      </a>
                    ))}
                  </div>
                </td>
                <td className="py-2 pr-3">{showDate(c.sop_submitted_at.slice(0, 10))}</td>
                <td className={`py-2 pr-3 ${waiting > SOP_WAIT_FLAG_DAYS ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
                  {waiting} day{waiting === 1 ? "" : "s"}
                </td>
                <td className="py-2 pr-3">
                  <SopDecision certificationId={c.id} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

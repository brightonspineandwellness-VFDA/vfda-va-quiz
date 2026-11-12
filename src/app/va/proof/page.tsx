import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Card, EmptyState, linkClass, PageHeader, StatusBadge } from "@/components/ui";
import { ProofUpload, ProofWarning } from "@/components/va/proof-upload";
import { requireRole } from "@/lib/auth";
import type { ProofRow } from "@/lib/va-flow";
import { loadToday } from "@/lib/va-training";

export default function ProofPage() {
  return (
    <SignedInPage area="VA">
      <Suspense fallback={<Loading />}>
        <Proof />
      </Suspense>
    </SignedInPage>
  );
}

const STATUS: Record<ProofRow["status"], { label: string; tone: "warning" | "success" | "danger" }> = {
  pending: { label: "Waiting for VFDA", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  redo: { label: "Redo", tone: "danger" },
};

async function Proof() {
  const user = await requireRole("va");
  const loaded = await loadToday(user);
  const days =
    loaded.kind === "ok" && "days" in loaded.today
      ? loaded.today.days.filter((d) => d.status !== "locked" && d.day.proof_of_work.length > 0)
      : [];

  return (
    <>
      <PageHeader
        title="Proof of work"
        description="For each day, upload screenshots or files, or paste a Loom or Drive link. VFDA checks them; the next day opens once your proof is accepted."
        breadcrumbs={[{ label: "Today", href: "/va" }, { label: "Proof of work" }]}
      />
      <ProofWarning />
      {days.length === 0 && <EmptyState title="Nothing to upload yet">Proof of work opens with your first training day.</EmptyState>}
      {loaded.kind === "ok" &&
        days.map((d) => {
          const uploads = loaded.proofs.filter((p) => p.schedule_day === d.day.code);
          const accepted = uploads.some((p) => p.status === "accepted");
          return (
            <Card key={d.day.code} number={d.index} title={d.day.title} description={`Day ${d.index} · ${d.day.code}`}>
              <ul className="ml-5 list-disc text-[0.9375rem]">
                {d.day.proof_of_work.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              {uploads.length > 0 && (
                <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line text-[0.9375rem]">
                  {uploads.map((p) => (
                    <li key={p.id} className="flex flex-col gap-1 px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        {p.link_url ? (
                          <a href={p.link_url} target="_blank" rel="noreferrer" className={`${linkClass} break-all`}>
                            {p.link_url}
                          </a>
                        ) : (
                          <span className="break-all">{p.file_name || "File"}</span>
                        )}
                        <StatusBadge label={STATUS[p.status].label} tone={STATUS[p.status].tone} />
                      </span>
                      {p.review_note && <span className="text-sm text-muted">VFDA: {p.review_note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {!accepted && user.officeId && <ProofUpload officeId={user.officeId} vaId={user.id} day={d.day.code} />}
            </Card>
          );
        })}
    </>
  );
}

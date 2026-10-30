import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ProofUpload, ProofWarning } from "@/components/va/proof-upload";
import { requireRole } from "@/lib/auth";
import { dayName, type ProofRow } from "@/lib/va-flow";
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

const STATUS: Record<ProofRow["status"], { label: string; className: string }> = {
  pending: { label: "Waiting for VFDA", className: "text-foreground/70" },
  accepted: { label: "Accepted", className: "text-green-700 dark:text-green-400" },
  redo: { label: "Redo", className: "text-red-700 dark:text-red-400" },
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
      <Link href="/va" className="self-start text-sm underline">
        ← Today
      </Link>
      <h1 className="text-2xl font-semibold">Proof of work</h1>
      <p className="text-foreground/70">
        For each day, upload screenshots or files, or paste a Loom or Drive link. VFDA checks them; the next day opens
        once your proof is accepted.
      </p>
      <ProofWarning />
      {days.length === 0 && <p>Proof of work opens with your first training day.</p>}
      {loaded.kind === "ok" &&
        days.map((d) => {
          const uploads = loaded.proofs.filter((p) => p.schedule_day === d.day.code);
          const accepted = uploads.some((p) => p.status === "accepted");
          return (
            <section key={d.day.code} className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
              <h2 className="font-semibold">{dayName(d)}</h2>
              <ul className="ml-5 list-disc text-sm">
                {d.day.proof_of_work.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              {uploads.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {uploads.map((p) => (
                    <li key={p.id} className="flex flex-col">
                      <span>
                        {p.link_url ? (
                          <a href={p.link_url} target="_blank" rel="noreferrer" className="underline">
                            {p.link_url}
                          </a>
                        ) : (
                          p.file_name || "File"
                        )}{" "}
                        · <span className={STATUS[p.status].className}>{STATUS[p.status].label}</span>
                      </span>
                      {p.review_note && <span className="text-foreground/70">VFDA: {p.review_note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {!accepted && user.officeId && <ProofUpload officeId={user.officeId} vaId={user.id} day={d.day.code} />}
            </section>
          );
        })}
    </>
  );
}

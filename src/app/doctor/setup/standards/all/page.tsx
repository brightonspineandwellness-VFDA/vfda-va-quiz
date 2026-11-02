import Link from "next/link";
import { Suspense } from "react";
import { RuleValue } from "@/components/setup/rule-value";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "../../load";

export default function AllStandardsPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/standards" className="text-sm text-foreground/60 hover:underline">
        ← VFDA standards
      </Link>
      <Suspense fallback={<Loading />}>
        <AllStandards />
      </Suspense>
    </SignedInPage>
  );
}

// The full list, read-only. Where a card says something different, the card's
// version (accepted by VFDA) is what's shown and used.
async function AllStandards() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;

  return (
    <>
      <h1 className="text-2xl font-semibold">VFDA standards</h1>
      <p className="text-foreground/70">
        What your VA follows where your cards don&apos;t say. To change one, tell VFDA or update your card.
      </p>
      <ul className="flex flex-col gap-3">
        {flow.standards.map(({ slot, row }) => (
          <li key={slot.key} className="flex flex-col gap-1 rounded-lg border border-foreground/15 px-4 py-3">
            <p className="font-medium">{slot.question}</p>
            <div className="text-sm">
              <RuleValue slot={slot} value={row?.rule ?? null} attachments={row?.attachments} fileUrls={interview.fileUrls} />
            </div>
            {row?.source === "card_import" && (
              <p className="text-xs text-foreground/60">From your card{row.document_name ? `: ${row.document_name}` : ""}</p>
            )}
            {(row?.source === "doctor" || row?.source === "vfda") && <p className="text-xs text-foreground/60">Your office&apos;s version</p>}
          </li>
        ))}
      </ul>
    </>
  );
}

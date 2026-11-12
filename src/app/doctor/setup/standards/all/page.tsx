import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { Suspense } from "react";
import { RuleValue } from "@/components/setup/rule-value";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "../../load";

export default function AllStandardsPage() {
  return (
    <SignedInPage area="Doctor">
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
  if (!setup) return <Notice tone="info" title="Your office isn't set up yet">Contact VFDA.</Notice>;
  const { interview, flow } = setup;

  return (
    <>
      <PageHeader
        title="VFDA standards"
        description="What your VA follows where your cards don't say. To change one, tell VFDA or update your card."
        breadcrumbs={[
          { label: "Home", href: "/doctor" },
          { label: "Office setup", href: "/doctor/setup" },
          { label: "VFDA standards", href: "/doctor/setup/standards" },
          { label: "All standards" },
        ]}
      />
      {!flow.standards.length && <EmptyState title="No VFDA standards for your office yet" />}
      <ul className="flex flex-col gap-3">
        {flow.standards.map(({ slot, row }) => (
          <Card as="li" key={slot.key} bodyClassName="gap-2">
            <p className="font-semibold">{slot.question}</p>
            <div className="text-[0.9375rem]">
              <RuleValue slot={slot} value={row?.rule ?? null} attachments={row?.attachments} fileUrls={interview.fileUrls} />
            </div>
            {row?.source === "card_import" && (
              <p>
                <Badge tone="info">From your card{row.document_name ? `: ${row.document_name}` : ""}</Badge>
              </p>
            )}
            {(row?.source === "doctor" || row?.source === "doctor_card" || row?.source === "vfda") && <p>
                <Badge tone="primary">Your office&apos;s version</Badge>
              </p>}
          </Card>
        ))}
      </ul>
    </>
  );
}

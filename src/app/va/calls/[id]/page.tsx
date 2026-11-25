import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallFeedbackView, FEEDBACK_COLUMNS, type FeedbackCall } from "@/components/calls/call-feedback";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { zoneOf } from "@/lib/week";

export default function CallFeedbackPage({ params }: PageProps<"/va/calls/[id]">) {
  return (
    <SignedInPage area="VA">
      <PageHeader
        title="Call feedback"
        breadcrumbs={[
          { label: "Today", href: "/va" },
          { label: "Call practice", href: "/va/calls" },
          { label: "Call feedback" },
        ]}
        actions={
          <ButtonLink href="/va/calls" variant="primary">
            Practice another call
          </ButtonLink>
        }
      />
      <Suspense fallback={<Loading />}>
        <Feedback params={params} />
      </Suspense>
    </SignedInPage>
  );
}

// Only the signed-in VA's own call.
async function Feedback({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("va");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data } = await db.from("practice_calls").select(FEEDBACK_COLUMNS).eq("id", id).eq("va_id", user.id).maybeSingle();
  if (!data) notFound();
  const office = await db.from("offices").select("time_zone").eq("id", (data as { office_id: string }).office_id).maybeSingle();
  return <CallFeedbackView call={data as unknown as FeedbackCall} timeZone={zoneOf((office.data as { time_zone: string | null } | null)?.time_zone)} audience="va" />;
}

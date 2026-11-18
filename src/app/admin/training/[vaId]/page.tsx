import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TestButton } from "@/components/settings/test-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { TestSendForm } from "@/components/training/forms";
import { ProgramView } from "@/components/training/program-view";
import { Card, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { vfdaEmails } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { generateProgramNow } from "@/lib/training-actions";
import { loadProgramPage } from "@/lib/training-program";

// "Generate training program now" asks Claude for the bank and 8 sheets while you wait.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminTrainingPage({ params }: PageProps<"/admin/training/[vaId]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <Program params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Program({ params }: { params: Promise<{ vaId: string }> }) {
  const user = await requireRole("vfda_admin");
  const { vaId } = await params;
  if (!UUID.test(vaId)) notFound();
  const db = createAdminClient();
  const { data: va } = await db.from("profiles").select("full_name, email, office_id, role").eq("id", vaId).maybeSingle();
  if (!va || va.role !== "va" || !va.office_id) notFound();
  const { data: office } = await db.from("offices").select("name").eq("id", va.office_id).maybeSingle();
  const data = await loadProgramPage(db, vaId, va.office_id);
  const name = (va.full_name || va.email) as string;
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Training programs", href: "/admin/training" },
          { label: `${office?.name ?? "Office"} › ${name}` },
        ]}
        title={`${name.split(/\s+/)[0]}'s training program`}
        description={`${office?.name ?? ""} · built from all quiz days: what ${name.split(/\s+/)[0]} knows, what to practice, and 8 sessions over 4 weeks.`}
      />
      <ProgramView data={data} vaName={name} base={`/admin/training/${vaId}`} admin />
      <Card title="VFDA tools" description="For testing. The real sends happen Sunday night; nothing here marks a session sent.">
        <div className="flex flex-col gap-1 text-sm">
          <TestButton action={generateProgramNow.bind(null, vaId)} label="Generate training program now" pendingLabel="Building the bank and 8 sheets… (a few minutes)" />
          <span className="text-muted">
            Replaces this VA&apos;s program.{" "}
            {data.readiness.missing.length > 0 && `Warning: ${data.readiness.missing.length} scheduled day(s) aren't submitted yet (${data.readiness.missing.join(", ")}).`}
          </span>
        </div>
        <TestSendForm vaId={vaId} defaultTo={vfdaEmails()[0] ?? user.email} />
      </Card>
    </>
  );
}

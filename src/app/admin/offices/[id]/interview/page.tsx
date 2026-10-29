import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { loadInterview } from "@/lib/interview-data";

export default function AdminInterviewPage({ params }: PageProps<"/admin/offices/[id]/interview">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/offices" className="text-sm text-foreground/60 hover:underline">
        ← Offices
      </Link>
      <Suspense fallback={<Loading />}>
        <AdminInterview params={params} />
      </Suspense>
    </SignedInPage>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function AdminInterview({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("vfda_admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadInterview(id);
  if (!data) notFound();

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {data.office.name}</h1>
      <InterviewForm data={data} isAdmin />
    </>
  );
}

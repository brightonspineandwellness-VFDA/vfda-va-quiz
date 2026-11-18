import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { SheetEditor } from "@/components/training/forms";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { basedOnText } from "@/lib/training-pdf";
import { loadProgram } from "@/lib/training-program";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// VFDA edits one Training Sheet before it's sent.
export default function EditSheetPage({ params }: PageProps<"/admin/training/[vaId]/session/[n]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <Editor params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function Editor({ params }: { params: Promise<{ vaId: string; n: string }> }) {
  await requireRole("vfda_admin");
  const { vaId, n } = await params;
  if (!UUID.test(vaId)) notFound();
  const db = createAdminClient();
  const { data: va } = await db.from("profiles").select("full_name, email, office_id").eq("id", vaId).maybeSingle();
  if (!va?.office_id) notFound();
  const { sessions } = await loadProgram(db, vaId, va.office_id);
  const s = sessions.find((x) => x.number === Number(n));
  if (!s?.sheet) notFound();
  const back = `/admin/training/${vaId}`;
  const name = (va.full_name || va.email) as string;
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Training programs", href: "/admin/training" },
          { label: name, href: back },
          { label: `Session ${s.number}` },
        ]}
        title={`Edit Session ${s.number}: ${s.sheet.title}`}
        description={`Week ${s.week}. The doctor gets this sheet on Sunday night; edits show in the PDF at once.`}
      />
      <Notice tone="info">{basedOnText({ focus: s.focus, vaName: name })}</Notice>
      <Card>
        {s.sent_at ? <p>This sheet was already sent, so it can&apos;t be changed.</p> : <SheetEditor sessionId={s.id} sheet={s.sheet} backHref={back} />}
      </Card>
    </>
  );
}

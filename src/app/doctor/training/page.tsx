import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Card, EmptyState, linkClass, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

// The office's VAs; one VA goes straight to their training program.
export default function DoctorTrainingPage() {
  return (
    <SignedInPage area="Doctor">
      <PageHeader title="Training program" breadcrumbs={[{ label: "Home", href: "/doctor" }, { label: "Training program" }]} />
      <Suspense fallback={<Loading />}>
        <List />
      </Suspense>
    </SignedInPage>
  );
}

async function List() {
  const user = await requireRole("doctor");
  const supabase = await createSessionClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").eq("office_id", user.officeId ?? "").eq("role", "va").is("deactivated_at", null).order("full_name");
  const vas = data ?? [];
  if (vas.length === 1) redirect(`/doctor/training/${vas[0].id}`);
  if (!vas.length) return <EmptyState title="No VAs yet" />;
  return (
    <Card>
      <ul className="flex flex-col gap-2">
        {vas.map((v) => (
          <li key={v.id}>
            <Link href={`/doctor/training/${v.id}`} className={linkClass}>
              {v.full_name || v.email}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

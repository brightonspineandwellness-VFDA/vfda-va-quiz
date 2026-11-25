import Link from "next/link";
import { Suspense } from "react";
import { CallProgress } from "@/components/calls/call-progress";
import { CallSettings } from "@/components/calls/call-settings";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { linkClass, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadCallSettings } from "@/lib/call-practice/access";
import { loadCallsFor } from "@/lib/call-practice/progress";
import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_TIME_ZONE } from "@/lib/week";

export default function AdminCallsPage({ searchParams }: PageProps<"/admin/calls">) {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="Call practice"
        description="Practice calls with an AI patient across every office: progress, pass rates, feedback, overrides and settings."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Call practice" }]}
      />
      <Suspense fallback={<Loading />}>
        <AdminCalls searchParams={searchParams} />
      </Suspense>
    </SignedInPage>
  );
}

async function AdminCalls({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("vfda_admin");
  const db = createAdminClient();
  const { office, va } = await searchParams;
  const [settings, { data: officeRows }, { data: onRows }, { data: vaRows }] = await Promise.all([
    loadCallSettings(db),
    db.from("offices").select("id, name").order("name"),
    db.from("call_practice_offices").select("office_id"),
    db.from("profiles").select("id, full_name, email, office_id").eq("role", "va").is("deactivated_at", null).order("full_name"),
  ]);
  const offices = (officeRows ?? []) as { id: string; name: string }[];
  const on = new Set(((onRows ?? []) as { office_id: string }[]).map((r) => r.office_id));
  const officeName = new Map(offices.map((o) => [o.id, o.name]));
  const officeId = typeof office === "string" && officeName.has(office) ? office : null;

  let vas = ((vaRows ?? []) as { id: string; full_name: string | null; email: string; office_id: string | null }[])
    .filter((v) => v.office_id && (officeId ? v.office_id === officeId : settings.allOffices || on.has(v.office_id)))
    .map((v) => ({ id: v.id, name: v.full_name || v.email, officeName: officeName.get(v.office_id!) ?? "" }));
  if (typeof va === "string" && vas.some((v) => v.id === va)) vas = vas.filter((v) => v.id === va);
  const calls = await loadCallsFor(db, { vaIds: vas.map((v) => v.id) });

  return (
    <>
      <CallSettings settings={settings} offices={offices.map((o) => ({ ...o, on: on.has(o.id) }))} />
      <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Filter by office">
        <Link href="/admin/calls" className={linkClass} aria-current={!officeId ? "page" : undefined}>
          All offices with Call practice
        </Link>
        {offices
          .filter((o) => settings.allOffices || on.has(o.id))
          .map((o) => (
            <Link key={o.id} href={`/admin/calls?office=${o.id}`} className={linkClass} aria-current={officeId === o.id ? "page" : undefined}>
              {o.name}
            </Link>
          ))}
      </nav>
      <CallProgress vas={vas} calls={calls} timeZone={DEFAULT_TIME_ZONE} linkBase="/admin/calls" showOffice />
    </>
  );
}

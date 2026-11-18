import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, Card, EmptyState, linkClass, PageHeader, Table, td, th } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadReadiness } from "@/lib/training-program";

export default function TrainingProgramsPage() {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="Training programs"
        description="Every VA's 4-week doctor training program: built once all their quiz days are done, sent Sunday nights."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Training programs" }]}
      />
      <Suspense fallback={<Loading />}>
        <Programs />
      </Suspense>
    </SignedInPage>
  );
}

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "primary" | "success" | "danger" | "warning" }> = {
  building: { label: "Building", tone: "warning" },
  ready: { label: "Ready (starts Sunday)", tone: "info" },
  running: { label: "Running", tone: "primary" },
  done: { label: "All sessions sent", tone: "success" },
  failed: { label: "Build failed", tone: "danger" },
};

async function Programs() {
  await requireRole("vfda_admin");
  const db = createAdminClient();
  const [{ data: vas }, { data: offices }, programs, sessions] = await Promise.all([
    db.from("profiles").select("id, full_name, email, office_id").eq("role", "va").is("deactivated_at", null).not("office_id", "is", null).order("full_name"),
    db.from("offices").select("id, name"),
    db.from("training_programs").select("va_id, office_id, status, trigger, start_sunday"),
    db.from("training_sessions").select("va_id, status"),
  ]);
  if (programs.error) {
    return (
      <Card>
        <p>Run supabase/training-program.sql in the Supabase SQL Editor first.</p>
      </Card>
    );
  }
  const list = (vas ?? []) as { id: string; full_name: string | null; email: string; office_id: string }[];
  if (!list.length) return <EmptyState title="No VAs yet" />;
  const officeName = new Map((offices ?? []).map((o) => [o.id, o.name as string]));
  const progress = await Promise.all(list.map((v) => loadReadiness(db, v.id, v.office_id).catch(() => null)));
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <th className={th}>VA</th>
            <th className={th}>Office</th>
            <th className={th}>Program</th>
            <th className={th}>Sessions done</th>
          </tr>
        </thead>
        <tbody>
          {list.map((v, n) => {
            const p = (programs.data ?? []).find((x) => x.va_id === v.id && x.office_id === v.office_id);
            const mine = (sessions.data ?? []).filter((s) => s.va_id === v.id);
            const r = progress[n];
            return (
              <tr key={v.id}>
                <td className={td}>
                  <Link href={`/admin/training/${v.id}`} className={linkClass}>
                    {v.full_name || v.email}
                  </Link>
                </td>
                <td className={td}>{officeName.get(v.office_id) ?? "–"}</td>
                <td className={td}>
                  {p ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={STATUS[p.status]?.tone ?? "neutral"}>{STATUS[p.status]?.label ?? p.status}</Badge>
                      {p.trigger === "test" && <Badge tone="neutral">test</Badge>}
                    </span>
                  ) : (
                    <span className="text-sm text-muted">Builds after all quiz days are done ({r ? `${r.done} of ${r.total}` : "?"} finished)</span>
                  )}
                </td>
                <td className={td}>{mine.length ? `${mine.filter((s) => s.status === "done").length} of ${mine.length}` : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

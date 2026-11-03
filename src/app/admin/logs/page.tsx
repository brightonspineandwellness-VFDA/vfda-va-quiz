import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";

export default function SystemLogPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">System log</h1>
      <p className="text-sm text-foreground/70">
        Every check a scenario failed while it was built or regenerated: the item, the field, what Claude wrote and why it was
        rejected. Most are fixed by the automatic rewrite; the rest show as &ldquo;needs review&rdquo; on the day.
      </p>
      <Suspense fallback={<Loading />}>
        <Log />
      </Suspense>
    </SignedInPage>
  );
}

// The latest entries first.
const LIMIT = 300;

async function Log() {
  await requireRole("vfda_admin");
  const supabase = await createSessionClient();
  const [{ data: rows }, { data: offices }] = await Promise.all([
    supabase
      .from("system_logs")
      .select("id, created_at, kind, office_id, schedule_day, item, field, value, reason")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase.from("offices").select("id, name"),
  ]);
  if (!rows?.length) return <p className="text-sm">Nothing logged yet.</p>;
  const officeName = new Map((offices ?? []).map((o) => [o.id, o.name]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-foreground/15 text-foreground/60">
          <tr>
            <th className="py-1 pr-3 font-medium">When</th>
            <th className="py-1 pr-3 font-medium">Office · day</th>
            <th className="py-1 pr-3 font-medium">Item</th>
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Value</th>
            <th className="py-1 pr-3 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-foreground/10 align-top">
              <td className="whitespace-nowrap py-1 pr-3">
                {new Date(r.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </td>
              <td className="py-1 pr-3">
                {r.office_id && r.schedule_day ? (
                  <Link href={`/admin/offices/${r.office_id}/scenarios/${r.schedule_day}`} className="underline">
                    {officeName.get(r.office_id) ?? "Office"} · {r.schedule_day}
                  </Link>
                ) : (
                  "–"
                )}
              </td>
              <td className="py-1 pr-3">{r.item ?? "–"}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.field ?? "–"}</td>
              <td className="max-w-xs py-1 pr-3 text-foreground/70">
                <span className="line-clamp-3 break-words">{r.value || "–"}</span>
              </td>
              <td className="py-1 pr-3">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === LIMIT && <p className="mt-2 text-sm text-foreground/60">Showing the latest {LIMIT}.</p>}
    </div>
  );
}

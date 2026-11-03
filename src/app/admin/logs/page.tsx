import Link from "next/link";
import { Suspense } from "react";
import { TestButton } from "@/components/settings/test-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { ITEM_TYPE_LABELS, parseDayRules, ruleFor } from "@/lib/day-rules";
import { recheckDayRules } from "@/lib/scenario-actions";
import { createSessionClient } from "@/lib/supabase/server";

export default function SystemLogPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">System log</h1>
      <p className="text-sm text-foreground/70">
        Every check a scenario failed while it was built, regenerated or rechecked: the item, the field, what Claude wrote and
        why it was rejected (and master items the day rules moved or left out). Most are fixed by the automatic rewrite; the
        rest show as &ldquo;needs review&rdquo; on the day.
      </p>
      <Suspense fallback={<Loading />}>
        <DayRules />
        <Log />
      </Suspense>
    </SignedInPage>
  );
}

// settings.day_rules, as each day's build reads it.
async function DayRules() {
  await requireRole("vfda_admin");
  const supabase = await createSessionClient();
  const [{ data: setting }, { data: days }] = await Promise.all([
    supabase.from("settings").select("value").eq("key", "day_rules").maybeSingle(),
    supabase.from("schedule_days").select("code, title").order("code"),
  ]);
  const rules = parseDayRules(setting?.value);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Day rules</h2>
      <p className="text-sm text-foreground/70">
        What each day may be written from, its item types and the topics it must never touch (settings{" "}
        <code>day_rules</code>). Every built item is checked against them; master items that break them move to the right
        day. Skipped days (extra phone drills) don&rsquo;t follow them.
        {!setting && " Not in the database yet: the defaults below are used."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-foreground/15 text-foreground/60">
            <tr>
              <th className="py-1 pr-3 font-medium">Day</th>
              <th className="py-1 pr-3 font-medium">Types</th>
              <th className="py-1 pr-3 font-medium">Only from</th>
              <th className="py-1 pr-3 font-medium">Never about</th>
            </tr>
          </thead>
          <tbody>
            {(days ?? []).map((d) => {
              const r = ruleFor(rules, d.code);
              return (
                <tr key={d.code} className="border-b border-foreground/10 align-top">
                  <td className="whitespace-nowrap py-1 pr-3">
                    {d.code} {d.title}
                  </td>
                  <td className="py-1 pr-3">{r.types.map((t) => ITEM_TYPE_LABELS[t]).join(", ")}</td>
                  <td className="py-1 pr-3">{r.sources ? `${r.sources.join(", ")}${r.standards === false ? " (no VFDA standards)" : ""}` : "every card mapped"}</td>
                  <td className="py-1 pr-3">{r.banned.join(", ") || "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-foreground/70">
        After the rules change, recheck the days already built: items that break them need review, and an approved day
        with such an item goes back to draft. Days a VA has started are never changed.
      </p>
      <TestButton action={recheckDayRules} label="Recheck built days against the day rules" pendingLabel="Checking…" />
    </section>
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

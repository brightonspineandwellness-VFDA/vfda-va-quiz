import Link from "next/link";
import { Suspense } from "react";
import { TestButton } from "@/components/settings/test-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Card, EmptyState, linkClass, PageHeader, Table, td, th } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { ITEM_TYPE_LABELS, parseDayRules, ruleFor } from "@/lib/day-rules";
import { recheckDayRules } from "@/lib/scenario-actions";
import { createSessionClient } from "@/lib/supabase/server";

export default function SystemLogPage() {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="System log"
        description="Scenario checks, day resets and skipped VA reports."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "System log" }]}
      />
      <p className="text-sm text-muted">
        Every check a scenario failed while it was built, regenerated or rechecked: the item, the field, what Claude wrote and
        why it was rejected (and master items the day rules moved or left out). Most are fixed by the automatic rewrite; the
        rest show as &ldquo;needs review&rdquo; on the day. Also every &ldquo;Reset day (test)&rdquo;: who reset which VA&rsquo;s
        day, and when. And every attempt Backfill VA reports skipped because it was graded in mock mode.
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
    <Card number={1} title="Day rules">
      <p className="text-sm text-muted">
        What each day may be written from, its item types and the topics it must never touch (settings{" "}
        <code>day_rules</code>). Every built item is checked against them; master items that break them move to the right
        day. Skipped days (extra phone drills) don&rsquo;t follow them.
        {!setting && " Not in the database yet: the defaults below are used."}
      </p>
      <Table>
          <thead>
            <tr>
              <th className={th}>Day</th>
              <th className={th}>Types</th>
              <th className={th}>Only from</th>
              <th className={th}>Never about</th>
            </tr>
          </thead>
          <tbody>
            {(days ?? []).map((d) => {
              const r = ruleFor(rules, d.code);
              return (
                <tr key={d.code}>
                  <td className={`${td} whitespace-nowrap`}>
                    {d.code} {d.title}
                  </td>
                  <td className={td}>{r.types.map((t) => ITEM_TYPE_LABELS[t]).join(", ")}</td>
                  <td className={td}>{r.sources ? `${r.sources.join(", ")}${r.standards === false ? " (no VFDA standards)" : ""}` : "every card mapped"}</td>
                  <td className={td}>{r.banned.join(", ") || "–"}</td>
                </tr>
              );
            })}
          </tbody>
      </Table>
      <p className="text-sm text-muted">
        After the rules change, recheck the days already built: items that break them need review, and an approved day
        with such an item goes back to draft. Days a VA has started are never changed.
      </p>
      <TestButton action={recheckDayRules} label="Recheck built days against the day rules" pendingLabel="Checking…" />
    </Card>
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
  if (!rows?.length) return <EmptyState title="Nothing logged yet">Failed scenario checks show here.</EmptyState>;
  const officeName = new Map((offices ?? []).map((o) => [o.id, o.name]));
  return (
    <Card number={2} title="Log" description={rows.length === LIMIT ? `Showing the latest ${LIMIT}.` : undefined}>
      <Table maxHeight="70vh">
        <thead>
          <tr>
            <th className={th}>When</th>
            <th className={th}>Office · day</th>
            <th className={th}>Item</th>
            <th className={th}>Field</th>
            <th className={th}>Value</th>
            <th className={th}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={`${td} whitespace-nowrap`}>
                {new Date(r.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </td>
              <td className={td}>
                {r.office_id && r.schedule_day ? (
                  <Link href={`/admin/offices/${r.office_id}/scenarios/${r.schedule_day}`} className={linkClass}>
                    {officeName.get(r.office_id) ?? "Office"} · {r.schedule_day}
                  </Link>
                ) : (
                  "–"
                )}
              </td>
              <td className={td}>
                {r.kind === "va_report_mock" && r.value ? (
                  <Link href={`/admin/attempts/${r.value}`} className={linkClass}>
                    {r.item ?? "Attempt"}
                  </Link>
                ) : (
                  (r.item ?? "–")
                )}
              </td>
              <td className={`${td} font-mono text-xs`}>{r.field ?? "–"}</td>
              <td className={`${td} max-w-xs text-muted`}>
                <span className="line-clamp-3 break-words">{r.value || "–"}</span>
              </td>
              <td className={td}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

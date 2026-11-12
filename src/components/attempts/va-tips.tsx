import { VaTipsEditor } from "@/components/attempts/va-tips-editor";
import { TipTagBadge } from "@/components/reports/standards";
import { Card, NumberBadge } from "@/components/ui";
import type { NeedsWorkItem } from "@/lib/quiz-report";
import { vaTipTags } from "@/lib/rule-source";
import { createSessionClient } from "@/lib/supabase/server";

// "Coaching tips given to the VA" on the admin and doctor attempt pages:
// exactly what the VA sees on My report. VFDA can edit it (no new email).
// Read as the signed-in user: row-level security limits a doctor to their office.
// `items`: the attempt's items below full points, for each tip's "VFDA standard" / "Card" tag.
export async function VaTips({ attemptId, admin, items = [] }: { attemptId: string; admin: boolean; items?: NeedsWorkItem[] }) {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.from("va_reports").select("alerts, tips, strengths, source, edited_at").eq("attempt_id", attemptId).maybeSingle();
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const tips = data ? list(data.tips) : [];
  const tags = vaTipTags(tips, items);
  return (
    <Card
      title="Coaching tips given to the VA"
      description={
        data && !error ? (
          <>
            What the VA sees on My report (no scenarios or answers).
            {data.source === "fallback" && " Written without Claude (fallback)."}
            {data.edited_at && ` Edited by VFDA ${new Date(data.edited_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`}
          </>
        ) : undefined
      }
    >
      {error || !data ? (
        <p className="text-muted">
          Not written yet.{admin && " They're written when the attempt is graded; for older attempts, run Backfill VA reports on Settings."}
        </p>
      ) : (
        <>
          {admin && (
            // The tags, read-only, above the editor.
            <TipList tips={tips} tags={tags} />
          )}
          {admin ? (
            <VaTipsEditor attemptId={attemptId} alerts={list(data.alerts)} tips={tips} strengths={list(data.strengths)} />
          ) : (
            <div className="flex flex-col gap-3 text-[0.9375rem]">
              {list(data.alerts).length > 0 && (
                <ul className="list-disc pl-5 font-medium text-danger">
                  {list(data.alerts).map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              <TipList tips={tips} tags={tags} />
              {list(data.strengths).length > 0 && (
                <>
                  <p className="font-semibold text-success">What they did well</p>
                  <ul className="list-disc pl-5">
                    {list(data.strengths).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// Numbered coaching tips, each with its tag.
export function TipList({ tips, tags }: { tips: string[]; tags: ReturnType<typeof vaTipTags> }) {
  if (!tips.length) return null;
  return (
    <ol className="flex flex-col gap-3">
      {tips.map((t, n) => (
        <li key={t} className="flex gap-3">
          <NumberBadge n={n + 1} />
          <div className="flex min-w-0 flex-col gap-1">
            <TipTagBadge tag={tags[n]} />
            <p>{t}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

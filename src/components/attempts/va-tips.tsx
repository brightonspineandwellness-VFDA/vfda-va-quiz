import { VaTipsEditor } from "@/components/attempts/va-tips-editor";
import { createSessionClient } from "@/lib/supabase/server";

// "Coaching tips given to the VA" on the admin and doctor attempt pages:
// exactly what the VA sees on My report. VFDA can edit it (no new email).
// Read as the signed-in user: row-level security limits a doctor to their office.
export async function VaTips({ attemptId, admin }: { attemptId: string; admin: boolean }) {
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("va_reports")
    .select("alerts, tips, strengths, source, edited_at")
    .eq("attempt_id", attemptId)
    .maybeSingle();
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3">
      <h2 className="text-lg font-semibold">Coaching tips given to the VA</h2>
      {error || !data ? (
        <p className="text-sm text-foreground/70">
          Not written yet.{admin && " They're written when the attempt is graded; for older attempts, run Backfill VA reports on Settings."}
        </p>
      ) : (
        <>
          <p className="text-xs text-foreground/60">
            What the VA sees on My report (no scenarios or answers).
            {data.source === "fallback" && " Written without Claude (fallback)."}
            {data.edited_at && ` Edited by VFDA ${new Date(data.edited_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`}
          </p>
          {admin ? (
            <VaTipsEditor attemptId={attemptId} alerts={list(data.alerts)} tips={list(data.tips)} strengths={list(data.strengths)} />
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              {list(data.alerts).length > 0 && (
                <ul className="list-disc pl-5 text-red-800 dark:text-red-300">
                  {list(data.alerts).map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              <ul className="list-disc pl-5">
                {list(data.tips).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              {list(data.strengths).length > 0 && (
                <>
                  <p className="font-medium">What they did well</p>
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
    </section>
  );
}

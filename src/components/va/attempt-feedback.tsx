import { createAdminClient } from "@/lib/supabase/server";
import { withOverride } from "@/lib/va-flow";

type Feedback = { reason?: string; missed_steps?: string[] } | null;

// The VA's own scores and feedback for some attempts, item by item: first try,
// the one repeat and both scores. Read on the server for the signed-in VA's
// attempts only (the caller passes ids it already checked); never answer keys.
export async function loadFeedback(attemptIds: string[]) {
  if (!attemptIds.length) return new Map<string, FeedbackItem[]>();
  const db = createAdminClient();
  const { data: items } = await db
    .from("attempt_items")
    .select("attempt_id, office_scenario_id, position, first_score, first_feedback, repeat_scenario_id, repeat_score, repeat_feedback, critical_error, vfda_override")
    .in("attempt_id", attemptIds)
    .order("position");
  const ids = [...new Set((items ?? []).map((i) => i.office_scenario_id))];
  const { data: scenarios } = ids.length
    ? await db.from("office_scenarios").select("id, code, type, points").in("id", ids)
    : { data: [] };
  const scenarioOf = new Map((scenarios ?? []).map((s) => [s.id, s]));
  const byAttempt = new Map<string, FeedbackItem[]>();
  for (const raw of items ?? []) {
    const s = scenarioOf.get(raw.office_scenario_id);
    const i = withOverride({ ...raw, ai_confidence: null }, raw.vfda_override);
    const first = raw.first_feedback as Feedback;
    const again = raw.repeat_feedback as Feedback;
    byAttempt.set(raw.attempt_id, [
      ...(byAttempt.get(raw.attempt_id) ?? []),
      {
        key: raw.office_scenario_id,
        code: s?.code ?? "",
        max: s?.type === "mc" ? s.points : 2,
        firstScore: i.first_score,
        repeated: !!raw.repeat_scenario_id,
        repeatScore: i.repeat_score,
        critical: i.critical_error,
        reason: first?.reason ?? "",
        missed: (first?.missed_steps ?? []).map(String),
        repeatReason: again?.reason ?? "",
      },
    ]);
  }
  return byAttempt;
}

export type FeedbackItem = {
  key: string;
  code: string;
  max: number;
  firstScore: number | null;
  repeated: boolean;
  repeatScore: number | null;
  critical: boolean;
  reason: string;
  missed: string[];
  repeatReason: string;
};

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.key}>
          <span className="font-medium">{i.code}</span>: {i.firstScore ?? "–"}/{i.max} first try
          {i.repeated && `, ${i.repeatScore ?? "–"}/${i.max} on repeat`}
          {i.critical && " · critical error"}
          {i.reason && <span className="block text-foreground/70">{i.reason}</span>}
          {i.missed.map((m) => (
            <span key={m} className="block text-foreground/70">
              Missed: {m}
            </span>
          ))}
          {i.repeatReason && <span className="block text-foreground/70">Repeat: {i.repeatReason}</span>}
        </li>
      ))}
    </ul>
  );
}

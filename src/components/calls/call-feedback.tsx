// One call's feedback, as the VA, their doctor and VFDA see it: the result
// (or VFDA's override), what went well, what to try next, the phone
// checklist, the cadence check with each rule's source, flags, and the
// transcript. No scores.

import { Badge, Card, Notice } from "@/components/ui";
import type { CallFeedback, CallFlag, ChecklistLine } from "@/lib/call-practice/grade";
import { CALL_TYPE_LABELS, ROLEPLAY_TITLES, type CallType, type Roleplay, type TranscriptEntry } from "@/lib/call-practice/types";

export type FeedbackCall = {
  call_type: CallType;
  roleplay: Roleplay | null;
  status: "in_progress" | "finished" | "abandoned";
  result: "passed" | "practice_again" | null;
  override_result: "passed" | "practice_again" | null;
  override_note: string | null;
  overridden_at: string | null;
  checklist: ChecklistLine[] | null;
  feedback: (CallFeedback & { critical_quote?: string | null }) | null;
  flags: CallFlag[] | null;
  transcript: TranscriptEntry[];
  started_at: string;
  finished_at: string | null;
  persona: { firstName?: string } | null;
};

export const FEEDBACK_COLUMNS =
  "id, va_id, office_id, call_type, roleplay, status, result, override_result, override_note, overridden_at, checklist, feedback, flags, transcript, started_at, finished_at, persona";

export const RESULT_LABEL = { passed: "Passed", practice_again: "Practice again" } as const;
export const resultTone = (r: "passed" | "practice_again") => (r === "passed" ? "success" : "warning");

export function callTitle(c: Pick<FeedbackCall, "call_type" | "roleplay">) {
  return c.roleplay ? `${CALL_TYPE_LABELS[c.call_type]}: ${ROLEPLAY_TITLES[c.roleplay]}` : CALL_TYPE_LABELS[c.call_type];
}

export function callLength(c: Pick<FeedbackCall, "started_at" | "finished_at">) {
  if (!c.finished_at) return "";
  const s = Math.max(0, Math.round((new Date(c.finished_at).getTime() - new Date(c.started_at).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function callDate(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}

const MARK = {
  met: { sign: "✓", cls: "bg-success-soft text-success", label: "Done" },
  missed: { sign: "!", cls: "bg-warning-soft text-warning", label: "Missed" },
  not_applicable: { sign: "–", cls: "bg-surface-muted text-muted", label: "Didn't come up" },
} as const;

function Lines({ lines }: { lines: ChecklistLine[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {lines.map((l, i) => (
        <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 py-2.5">
          <span aria-label={MARK[l.status].label} className={`grid h-6 w-6 place-items-center rounded-full text-sm font-bold ${MARK[l.status].cls}`}>
            {MARK[l.status].sign}
          </span>
          <div className="min-w-0">
            <p className="font-medium capitalize">{l.item}</p>
            {l.note && <p className="text-[0.9375rem] text-muted">{l.note}</p>}
            {l.source && <p className="text-sm text-muted">{l.source}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CallFeedbackView({ call, timeZone, audience }: { call: FeedbackCall; timeZone: string; audience: "va" | "staff" }) {
  const result = call.override_result ?? call.result;
  const phone = (call.checklist ?? []).filter((l) => l.kind === "phone");
  const cadence = (call.checklist ?? []).filter((l) => l.kind === "cadence" && l.status !== "not_applicable");
  const you = audience === "va";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-muted">
        <span>{callTitle(call)}</span>
        {call.persona?.firstName && <span>· {call.persona.firstName} (AI patient)</span>}
        <span>· {callDate(call.started_at, timeZone)}</span>
        {callLength(call) && <span>· {callLength(call)}</span>}
        {result && (
          <Badge tone={resultTone(result)} size="lg">
            {RESULT_LABEL[result]}
          </Badge>
        )}
      </div>

      {call.status === "abandoned" && <Notice tone="neutral">This call was closed before the end, so there&apos;s no feedback.</Notice>}
      {call.status === "finished" && !call.result && (
        <Notice tone="info">The feedback for this call isn&apos;t ready. {you ? "Open the call again in a moment." : ""}</Notice>
      )}
      {call.override_result && (
        <Notice tone="info" title={`VFDA set this call to ${RESULT_LABEL[call.override_result]}`}>
          {call.override_note && <p>{call.override_note}</p>}
        </Notice>
      )}
      {call.feedback?.critical_quote && (
        <Notice tone="danger" title="Safety or privacy issue">
          <p>&ldquo;{call.feedback.critical_quote}&rdquo;</p>
        </Notice>
      )}
      {!!call.flags?.length && (
        <Notice tone="warning" title={you ? "This looked like real patient information" : "Possible real patient data"}>
          <ul className="list-disc pl-5">
            {call.flags.map((f, i) => (
              <li key={i}>
                &ldquo;{f.quote}&rdquo;: {f.reason}
              </li>
            ))}
          </ul>
          {you && <p>Practice calls are with made-up patients. Never use a real patient&apos;s name, birthday or phone number.</p>}
        </Notice>
      )}

      {call.feedback && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="What went well">
            <ul className="list-disc space-y-1.5 pl-5">
              {call.feedback.went_well.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Card>
          <Card title="Try this next time">
            <ul className="list-disc space-y-1.5 pl-5">
              {call.feedback.try_next.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {!!phone.length && (
        <Card title="Phone checklist">
          <Lines lines={phone} />
        </Card>
      )}
      {!!cadence.length && (
        <Card title="Scheduling cadence" description="Did the booking follow how this office books?">
          <Lines lines={cadence} />
        </Card>
      )}

      <Card title="Transcript">
        <details>
          <summary className="cursor-pointer font-medium text-primary">Show the whole call</summary>
          <div className="mt-3 flex flex-col gap-2">
            {call.transcript.map((t, i) => (
              <p key={i}>
                <span className="font-semibold">{t.speaker === "va" ? (you ? "You" : "VA") : (call.persona?.firstName ?? "Patient")}:</span> {t.text}
              </p>
            ))}
          </div>
        </details>
        <p className="text-sm text-muted">Transcript only. No audio is recorded.</p>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { callDate, callTitle, RESULT_LABEL, resultTone } from "@/components/calls/call-feedback";
import { Badge, Card, EmptyState, linkClass, Table, td, th } from "@/components/ui";
import { effectiveResult, GOAL, passRateText, summarize, type CallSummaryRow } from "@/lib/call-practice/progress";

export type ProgressVa = { id: string; name: string; officeName?: string };

// Call practice progress per VA, then the most recent calls. Used on the
// doctor's and VFDA's Call practice pages (callers load only what the viewer may see).
export function CallProgress({
  vas,
  calls,
  timeZone,
  linkBase,
  showOffice = false,
}: {
  vas: ProgressVa[];
  calls: CallSummaryRow[];
  timeZone: string;
  linkBase: string;
  showOffice?: boolean;
}) {
  const nameOf = new Map(vas.map((v) => [v.id, v.name]));
  const recent = calls.filter((c) => c.status === "finished").slice(0, 40);
  return (
    <>
      <Card title="Progress by VA" description={`Goal: ${GOAL} easy and ${GOAL} challenging calls. Every finished call counts; the pass rate is beside each count.`}>
        {!vas.length ? (
          <EmptyState title="No VAs yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>VA</th>
                {showOffice && <th className={th}>Office</th>}
                <th className={th}>Easy</th>
                <th className={th}>Challenging</th>
                <th className={th}>W2D1 roleplays</th>
                <th className={th}>W2D2 roleplays</th>
                <th className={th}>Flags</th>
                <th className={th}>Last call</th>
              </tr>
            </thead>
            <tbody>
              {vas.map((v) => {
                const p = summarize(calls.filter((c) => c.va_id === v.id));
                return (
                  <tr key={v.id} className="border-t border-line">
                    <td className={td}>
                      <Link href={`${linkBase}?va=${v.id}`} className={linkClass}>
                        {v.name}
                      </Link>
                    </td>
                    {showOffice && <td className={td}>{v.officeName}</td>}
                    <td className={`${td} tabular-nums`}>
                      {Math.min(p.easy.finished, GOAL)} / {GOAL}
                      <span className="block text-sm text-muted">{passRateText(p.easy)}</span>
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {Math.min(p.challenging.finished, GOAL)} / {GOAL}
                      <span className="block text-sm text-muted">{passRateText(p.challenging)}</span>
                    </td>
                    <td className={td}>
                      <Badge tone={p.w2d1Passed === 3 ? "success" : "neutral"}>{p.w2d1Passed} of 3 passed</Badge>
                    </td>
                    <td className={td}>
                      <Badge tone={p.w2d2Passed === 3 ? "success" : "neutral"}>{p.w2d2Passed} of 3 passed</Badge>
                    </td>
                    <td className={td}>{p.flagged ? <Badge tone="warning">{p.flagged}</Badge> : <span className="text-muted">None</span>}</td>
                    <td className={td}>{p.lastCallAt ? callDate(p.lastCallAt, timeZone) : <span className="text-muted">No calls yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title="Recent calls">
        {!recent.length ? (
          <EmptyState title="No calls yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>VA</th>
                <th className={th}>Call</th>
                <th className={th}>Result</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => {
                const r = effectiveResult(c);
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className={td}>{callDate(c.started_at, timeZone)}</td>
                    <td className={td}>{nameOf.get(c.va_id) ?? "VA"}</td>
                    <td className={td}>
                      <Link href={`${linkBase}/${c.id}`} className={linkClass}>
                        {callTitle(c)}
                      </Link>
                    </td>
                    <td className={td}>
                      {r ? <Badge tone={resultTone(r)}>{RESULT_LABEL[r]}</Badge> : <span className="text-muted">Feedback pending</span>}
                      {c.override_result && <span className="block text-sm text-muted">VFDA override</span>}
                      {Array.isArray(c.flags) && c.flags.length > 0 && <span className="block text-sm text-warning">Flagged</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

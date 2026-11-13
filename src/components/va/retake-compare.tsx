import { Badge, StatusBadge, Table, td, th, tdNum, thNum } from "@/components/ui";
import type { RetakeComparison } from "@/lib/retake";
import { RESULT_LABELS } from "@/lib/va-flow";

// A retake next to its first try: both totals, then every question's
// first-try and retake score, the ones missed the first time highlighted.
export function RetakeCompare({ data }: { data: RetakeComparison }) {
  return (
    <div className="flex flex-col gap-3 text-[0.9375rem]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge tone="accent">Retake</Badge>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted">Retake</span>
          <span className="font-semibold tabular-nums">
            {data.retake.submitted ? `${data.retake.points}/${data.retake.max} (${data.retake.percent}%)` : "not finished"}
          </span>
          {data.retake.submitted && data.retake.result && <StatusBadge label={RESULT_LABELS[data.retake.result]} />}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted">First try (official)</span>
          <span className="font-semibold tabular-nums">
            {data.first.points}/{data.first.max} ({data.first.percent}%)
          </span>
          {data.first.result && <StatusBadge label={RESULT_LABELS[data.first.result]} />}
        </span>
      </div>
      <Table className="max-w-lg">
        <thead>
          <tr>
            <th className={th}>Question</th>
            <th className={thNum}>First try</th>
            <th className={thNum}>Retake</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.code} className={l.missedFirst ? "!bg-warning-soft font-medium" : ""}>
              <td className={td}>
                {l.code} <span className="text-xs text-muted">{l.workflow}</span>
              </td>
              <td className={tdNum}>{l.first === null ? "ungraded" : `${l.first}/${l.points}`}</td>
              <td className={tdNum}>{l.retake === null ? "–" : `${l.retake}/${l.points}`}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-sm text-muted">
        Highlighted: below full points the first time ({data.fixed} of {data.missedFirst} got full points on the retake). The first try
        stays the official score.
      </p>
    </div>
  );
}

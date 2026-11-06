import type { RetakeComparison } from "@/lib/retake";
import { RESULT_LABELS } from "@/lib/va-flow";

// A retake next to its first try: both totals, then every question's
// first-try and retake score, the ones missed the first time highlighted.
export function RetakeCompare({ data }: { data: RetakeComparison }) {
  const label = (r: RetakeComparison["first"]["result"]) => (r ? ` · ${RESULT_LABELS[r]}` : "");
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          RETAKE
        </span>
        Retake{" "}
        <span className="font-medium">
          {data.retake.submitted ? `${data.retake.points}/${data.retake.max} (${data.retake.percent}%)${label(data.retake.result)}` : "not finished"}
        </span>{" "}
        · First try (official){" "}
        <span className="font-medium">
          {data.first.points}/{data.first.max} ({data.first.percent}%){label(data.first.result)}
        </span>
      </p>
      <table className="w-full max-w-md text-left">
        <thead className="text-foreground/60">
          <tr>
            <th className="py-1 pr-3 font-normal">Question</th>
            <th className="py-1 pr-3 font-normal">First try</th>
            <th className="py-1 font-normal">Retake</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr
              key={l.code}
              className={l.missedFirst ? "bg-amber-100 font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100" : ""}
            >
              <td className="py-0.5 pr-3 pl-1">
                {l.code} <span className="text-xs opacity-70">{l.workflow}</span>
              </td>
              <td className="py-0.5 pr-3">{l.first === null ? "ungraded" : `${l.first}/${l.points}`}</td>
              <td className="py-0.5">{l.retake === null ? "–" : `${l.retake}/${l.points}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-foreground/60">
        Highlighted: missed the first time ({data.fixed} of {data.missedFirst} got full points on the retake). The first try
        stays the official score.
      </p>
    </div>
  );
}

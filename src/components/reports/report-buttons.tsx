import { ButtonAnchor } from "@/components/ui";

// "Doctor report (PDF)" and "VA report" for one finished attempt, each
// opening in a new tab. The doctor/VFDA PDF is made from the current data
// (it can take a few seconds); the VA report is exactly what the VA sees on My report.
export function ReportButtons({ attemptId, area, compact = false }: { attemptId: string; area: "admin" | "doctor"; compact?: boolean }) {
  return (
    <span className="flex flex-wrap gap-2">
      <ButtonAnchor href={`/${area}/attempts/${attemptId}/report-pdf?view=1`} target="_blank" rel="noopener" size="sm">
        {compact ? "Doctor report" : "Doctor report (PDF)"}
      </ButtonAnchor>
      <ButtonAnchor href={`/${area}/attempts/${attemptId}/va-report-pdf`} target="_blank" rel="noopener" size="sm">
        VA report
      </ButtonAnchor>
    </span>
  );
}

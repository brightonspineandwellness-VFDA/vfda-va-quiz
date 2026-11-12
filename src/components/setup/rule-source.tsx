import { Badge } from "@/components/ui";
import type { RuleRow } from "@/lib/doctor-flow";

// Where a rule came from: the card (with its quote), the doctor, or VFDA.
export function RuleSource({ row }: { row: RuleRow }) {
  if (row.source === "doctor_card") {
    return (
      <p className="text-sm text-muted">
        Your answer on the <span className="font-medium">VA Office Rules</span> card
        {row.source_quote && <>: &ldquo;{row.source_quote}&rdquo;</>}
      </p>
    );
  }
  if (row.source !== "card_import") {
    return (
      <p className="text-sm text-muted">
        {row.source === "doctor" ? "You answered this" : row.source === "vfda_default" ? "VFDA standard" : "Entered by VFDA"}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted">
      From <span className="font-medium">{row.document_name ?? "your cards"}</span>
      {row.source_quote && <>: &ldquo;{row.source_quote}&rdquo;</>}
      {row.partial && <Badge tone="warning" className="ml-1">partial</Badge>}
    </p>
  );
}

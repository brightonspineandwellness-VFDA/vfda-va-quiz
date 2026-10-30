import type { RuleRow } from "@/lib/doctor-flow";

// Where a rule came from: the card (with its quote), the doctor, or VFDA.
export function RuleSource({ row }: { row: RuleRow }) {
  if (row.source !== "card_import") {
    return (
      <p className="text-xs text-foreground/60">
        {row.source === "doctor" ? "You answered this" : row.source === "vfda_default" ? "VFDA standard" : "Entered by VFDA"}
      </p>
    );
  }
  return (
    <p className="text-xs text-foreground/60">
      From <span className="font-medium">{row.document_name ?? "your cards"}</span>
      {row.source_quote && <>: &ldquo;{row.source_quote}&rdquo;</>}
      {row.partial && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-900 dark:text-amber-100">partial</span>}
    </p>
  );
}

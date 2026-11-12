import { showDate } from "@/lib/va-flow";

// Who did a setup step, and when: any doctor of the office (by name) or VFDA.
export function ByLine({ verb, name, at }: { verb: string; name: string | null | undefined; at?: string | null }) {
  if (!name) return null;
  return (
    <span className="text-sm text-muted">
      {verb} by {name}
      {at ? ` · ${showDate(at.slice(0, 10))}` : ""}
    </span>
  );
}

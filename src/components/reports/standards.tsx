import { Badge, Notice } from "@/components/ui";
import { STANDARDS_NOTICE, tipTagText, type TipTag } from "@/lib/rule-source";

// "Some answers were checked against VFDA standards": shown under the Alerts
// box when any item or coaching tip relied on a VFDA standard; nothing otherwise.
export function StandardsNotice({ rules, audience }: { rules: string[]; audience: "doctor" | "va" }) {
  if (!rules.length) return null;
  return (
    <Notice tone="info" title={STANDARDS_NOTICE.title} role="note">
      <p>{audience === "doctor" ? STANDARDS_NOTICE.doctor : STANDARDS_NOTICE.va}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </Notice>
  );
}

// A coaching tip's tag: "VFDA standard" (blue) or "Card: <name>" (gray).
export function TipTagBadge({ tag }: { tag: TipTag | null | undefined }) {
  if (!tag) return null;
  return (
    <Badge tone={tag.kind === "vfda_standard" ? "info" : "neutral"} className="self-start">
      {tipTagText(tag)}
    </Badge>
  );
}

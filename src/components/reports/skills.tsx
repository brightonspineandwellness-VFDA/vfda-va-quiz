import { TipTagBadge } from "@/components/reports/standards";
import { NumberBadge, StatusBadge } from "@/components/ui";
import type { TipTag } from "@/lib/rule-source";
import type { WentWellGroup } from "@/lib/skills";
import { COMPLETED, progressText } from "@/lib/va-flow";

// What VAs and doctors see instead of scores: Completed ✓, the label, "Day X
// of Y completed" with a bar, the skills shown as a checkmark list by
// workflow, and the skills to practice with their card and tag.

// "Day 6 of 10 completed" and one segment per day, the done ones teal.
export function DayProgress({ progress, compact = false }: { progress: { done: number; total: number }; compact?: boolean }) {
  const { done, total } = progress;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {!compact && <span className="font-semibold">{progressText(progress)}</span>}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={progressText(progress)}
        className="flex w-full gap-1"
      >
        {Array.from({ length: Math.max(total, 1) }, (_, i) => (
          <span key={i} className={`h-2 flex-1 rounded-full ${i < done ? "bg-accent" : "bg-surface-muted"}`} />
        ))}
      </div>
    </div>
  );
}

// The three tiles at the top of a report: Status, Result, progress.
export function CompletedTiles({
  resultLabel,
  progress,
  progressCaption = "Your progress",
}: {
  resultLabel: string;
  progress: { done: number; total: number } | null;
  progressCaption?: string;
}) {
  const tile = "flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)]";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className={tile}>
        <span className="text-sm text-muted">Status</span>
        <span>
          <StatusBadge label={COMPLETED} size="lg" />
        </span>
      </div>
      <div className={tile}>
        <span className="text-sm text-muted">Result</span>
        <span>
          <StatusBadge label={resultLabel} size="lg" />
        </span>
      </div>
      {progress && (
        <div className={tile}>
          <span className="text-sm text-muted">{progressCaption}</span>
          <DayProgress progress={progress} />
        </div>
      )}
    </div>
  );
}

// The skills shown, as green pills with a check mark, grouped by workflow.
export function SkillChips({ groups }: { groups: WentWellGroup[] }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, n) => (
        <div key={`${g.name}-${n}`} className="flex flex-col gap-1.5">
          {g.name && <p className="text-sm font-semibold text-foreground">{g.name}</p>}
          <ul className="flex flex-wrap gap-2">
            {g.bullets.map((b) => (
              <li key={b} className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-3 py-1 text-sm text-foreground">
                <span aria-hidden="true" className="font-bold text-success">
                  ✓
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// "Skills to practice": numbered, each with its "VFDA standard" / card tag.
export function PracticeList({ items }: { items: { text: string; tag: TipTag | null }[] }) {
  if (!items.length) return null;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((t, n) => (
        <li key={`${n}-${t.text}`} className="flex gap-3">
          <NumberBadge n={n + 1} tone="accent" />
          <div className="flex min-w-0 flex-col gap-1">
            <p>{t.text}</p>
            <TipTagBadge tag={t.tag} />
          </div>
        </li>
      ))}
    </ol>
  );
}

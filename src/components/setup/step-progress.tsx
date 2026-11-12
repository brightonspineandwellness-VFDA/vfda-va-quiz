import { Stepper, type Step as StepperStep } from "@/components/ui";
import type { Step, StepKey } from "@/lib/doctor-flow";

// Progress by step (Profile ... VFDA standards), not by question count: a
// stepper with numbered circles and a green check when done. Locked steps
// are shown but not linked.
export function StepProgress({ steps, current, links = true }: { steps: Step[]; current?: StepKey; links?: boolean }) {
  const done = steps.filter((s) => s.state === "done").length;
  // Without a current page, the first step not done yet is the one to do.
  const active = current ?? steps.find((s) => s.state !== "done" && s.state !== "locked")?.key;
  const items: StepperStep[] = steps.map((s) => ({
    label: s.label,
    detail: s.detail,
    href: links ? s.href : undefined,
    state: s.state === "done" ? "done" : s.state === "locked" ? "locked" : s.key === active ? "current" : "todo",
  }));
  return (
    <nav aria-label="Setup steps" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.06)] sm:px-6">
      <p className="text-sm text-muted">{done === steps.length ? "All steps done. Thank you!" : `${done} of ${steps.length} steps done`}</p>
      <Stepper steps={items} />
    </nav>
  );
}

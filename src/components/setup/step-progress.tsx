import Link from "next/link";
import type { Step } from "@/lib/doctor-flow";

const STATE_STYLES = {
  done: "bg-green-600",
  waiting: "bg-amber-400",
  todo: "bg-foreground/15",
};

// Progress by step (Setup, Your cards, VFDA standards), not by question count.
export function StepProgress({ steps, current, links = true }: { steps: Step[]; current?: Step["key"]; links?: boolean }) {
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <nav aria-label="Setup steps" className="flex flex-col gap-2">
      <p className="text-sm text-foreground/70">
        {done === steps.length ? "All steps done. Thank you!" : `${done} of ${steps.length} steps done`}
      </p>
      <ol
        className="grid grid-cols-3 gap-2"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label="Setup progress"
      >
        {steps.map((step, i) => {
          const body = (
            <>
              <span className={`block h-2 rounded-full ${STATE_STYLES[step.state]}`} />
              <span className={`mt-1.5 block text-sm ${step.key === current ? "font-semibold" : ""}`}>
                {i + 1}. {step.label}
                {step.state === "done" && <span className="ml-1 text-green-700 dark:text-green-400">✓</span>}
              </span>
              <span className="block text-xs text-foreground/60">{step.detail}</span>
            </>
          );
          return (
            <li key={step.key} aria-current={step.key === current ? "step" : undefined}>
              {links ? (
                <Link href={step.href} className="block rounded-md hover:bg-foreground/5">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

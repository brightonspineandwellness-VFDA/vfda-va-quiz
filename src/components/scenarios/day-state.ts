// How a training day's build and approval read on VFDA's scenario pages.

import type { DaySummary } from "@/lib/scenario-data";

export const KIND_LABELS = {
  standard: "Standard scenarios",
  gray: "Built from gray cards",
  skipped: "Skipped: 20 extra phone drills",
} as const;

export function dayState(d: DaySummary): { label: string; tone: "muted" | "ok" | "warn" | "bad" } {
  const s = d.status;
  if (!s || s.build_status === "none") return { label: "Not built", tone: "muted" };
  if (s.build_status === "running") return { label: "Building…", tone: "muted" };
  if (s.build_status === "failed") return { label: `Build failed: ${s.build_error ?? "unknown error"}`, tone: "bad" };
  if (d.approved) return { label: `Approved: version ${s.live_version} live for VAs`, tone: "ok" };
  // A newer version being reviewed while an older one stays live.
  const draft = s.live_version ? `Version ${s.build_version} (version ${s.live_version} live for VAs): ` : "";
  if (d.needsReview) {
    return { label: `${draft}${d.needsReview} item${d.needsReview > 1 ? "s" : ""} need${d.needsReview > 1 ? "" : "s"} review`, tone: "bad" };
  }
  if (d.missing) return { label: `${draft}${d.missing} need office rules`, tone: "warn" };
  return { label: `${draft}Ready for review`, tone: "warn" };
}

export const TONES = {
  muted: "text-foreground/60",
  ok: "text-green-700 dark:text-green-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-red-700 dark:text-red-400",
};

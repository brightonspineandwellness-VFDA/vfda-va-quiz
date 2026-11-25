// The shared UI pieces the call report uses, re-exported in one place.
export { Badge, ButtonAnchor, Card, EmptyState, linkClass, Notice } from "@/components/ui";

export const resultToneOf = (label: string) =>
  label === "On track" ? ("success" as const) : label === "Building skills" ? ("warning" as const) : ("info" as const);

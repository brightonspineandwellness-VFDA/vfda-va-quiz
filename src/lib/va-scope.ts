// What a VA does at their office ("What this VA does"): each role maps to its
// training days and workflows. Days and workflows outside the VA's roles are
// skipped: not on their Today page, never blocking the next day, "n/a" on the
// certification grid and left off the certificate. W1D1 (Basics & VA
// Onboarding) is always included, and so is the office's gray card day and
// its gray card workflows. Pure functions, so pages, the server and tests
// share them.

export const VA_SCOPES = [
  { key: "scheduling", label: "Scheduling", days: ["W1D4"], workflows: ["WF02", "WF03"] },
  { key: "phones", label: "Phones", days: ["W2D1", "W2D2"], workflows: ["WF04", "WF09"] },
  { key: "texting", label: "Texting", days: ["W1D3"], workflows: ["WF05"] },
  { key: "ehr", label: "EHR / charting", days: ["W1D2"], workflows: ["WF06"] },
  { key: "new_patient", label: "New patient & re-exam", days: ["W1D5"], workflows: ["WF01"] },
  { key: "insurance", label: "Insurance", days: ["W2D3"], workflows: ["WF07"] },
  { key: "billing", label: "Billing", days: ["W2D4"], workflows: ["WF08"] },
  { key: "reporting", label: "Daily reporting", days: [], workflows: ["WF10"] },
] as const;

export type ScopeKey = (typeof VA_SCOPES)[number]["key"];
export const SCOPE_KEYS: ScopeKey[] = VA_SCOPES.map((s) => s.key);

// Always in every VA's training: Basics & VA Onboarding, and the office's gray cards.
export const ALWAYS_DAYS = ["W1D1", "W2D5"];

// profiles.va_scope: null (or empty) means everything, the default.
export function normalizeScope(raw: unknown): ScopeKey[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...SCOPE_KEYS];
  const keys = raw.filter((k): k is ScopeKey => SCOPE_KEYS.includes(k as ScopeKey));
  return keys.length ? SCOPE_KEYS.filter((k) => keys.includes(k)) : [...SCOPE_KEYS];
}

// Checkbox values from a form: only known roles, in order; at least one.
export function parseScope(values: unknown[]): { scope: ScopeKey[] } | { error: string } {
  const keys = SCOPE_KEYS.filter((k) => values.map(String).includes(k));
  return keys.length ? { scope: keys } : { error: "Pick at least one thing this VA does." };
}

const isAll = (scope: ScopeKey[]) => SCOPE_KEYS.every((k) => scope.includes(k));
const mapped = new Set<string>(VA_SCOPES.flatMap((s) => [...s.days]));

// A day is in scope when it's always included, one of the VA's roles trains
// on it, or no role claims it (a day added to the bank later).
export function dayInScope(scope: ScopeKey[], day: string) {
  if (ALWAYS_DAYS.includes(day) || !mapped.has(day)) return true;
  return VA_SCOPES.some((s) => scope.includes(s.key) && (s.days as readonly string[]).includes(day));
}

// Gray card workflows (WF-G1, ...) are always in scope.
export function workflowInScope(scope: ScopeKey[], code: string) {
  if (!/^WF\d+$/.test(code)) return true;
  const claimed = VA_SCOPES.some((s) => (s.workflows as readonly string[]).includes(code));
  return !claimed || VA_SCOPES.some((s) => scope.includes(s.key) && (s.workflows as readonly string[]).includes(code));
}

export function scopeText(scope: ScopeKey[]) {
  return isAll(scope) ? "All roles" : VA_SCOPES.filter((s) => scope.includes(s.key)).map((s) => s.label).join(", ");
}

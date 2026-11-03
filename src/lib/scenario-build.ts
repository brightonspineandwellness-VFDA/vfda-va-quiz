// Building an office's scenarios (SPEC section 3 step 6, section 6 "Which days
// and scenarios an office gets"), as pure functions: which days the office
// gets and how, which master scenarios apply, and filling every {PLACEHOLDER}
// with the office's accepted rules. Claude's part (src/lib/scenario-ai.ts) is
// checked here too, so nothing malformed reaches the database.

import type { ItemType } from "@/lib/day-rules";
import { applies, MATRIX_COLUMNS, type MatrixRow, type Profile } from "@/lib/interview";

export type MasterScenario = {
  id: string;
  schedule_day: string;
  code: string;
  version: string;
  workflow: string;
  part: string;
  part_title: string;
  condition: string;
  type: "mc" | "situational";
  stem: string;
  options: string[] | null;
  options_rule: string | null;
  answer: string | null;
  correct_response: CorrectResponse | null;
  critical_fail: string | null;
  escalation_level: string;
  points: number;
  answer_format: string | null;
  repeat_variant: string | null;
  position: number;
};

export type CorrectResponse = string[] | Record<string, string[]>;

export type DayKind = "standard" | "gray" | "skipped";

export type BuildDay = { code: string; title: string; condition: string; answer_format: string };

// Every day in settings.sequence, and how the office gets it: its own master
// scenarios, gray card items (W2D5 with gray cards), or, when its condition is
// false, 20 extra phone drills instead (settings.skipped_day_rule).
export function officeDays(input: {
  sequence: string[];
  days: BuildDay[];
  conditions: Record<string, string>;
  profile: Profile;
  grayDay: string; // the day built from gray cards: "W2D5"
}): { day: BuildDay; kind: DayKind }[] {
  const byCode = new Map(input.days.map((d) => [d.code, d]));
  return input.sequence
    .map((code) => byCode.get(code))
    .filter((d): d is BuildDay => !!d)
    .map((day) => ({
      day,
      kind: !applies(day.condition, input.conditions, input.profile)
        ? "skipped"
        : day.code === input.grayDay
          ? "gray"
          : "standard",
    }));
}

// Version A masters for a day whose own condition holds for the office
// (W1D5 B or B-alt, W2D1 B3 or B3-alt, W2D4 parts by billing type).
export function selectMasters(masters: MasterScenario[], day: string, conditions: Record<string, string>, profile: Profile) {
  return masters
    .filter((m) => m.schedule_day === day && m.version === "A" && applies(m.condition, conditions, profile))
    .sort((a, b) => a.position - b.position || a.code.localeCompare(b.code));
}

// ---------------------------------------------------------------------------
// Rule values as text.
// ---------------------------------------------------------------------------

export type RuleForBuild = { rule_slot_key: string; rule: unknown; source_document_id: string | null; source?: string };

const matrixLine = (row: Partial<MatrixRow>) =>
  `${row.visit_type || "Visit"}: ` +
  MATRIX_COLUMNS.filter((c) => c.key !== "visit_type" && row[c.key]?.trim())
    .map((c) => `${c.label.toLowerCase()} ${row[c.key]!.trim()}`)
    .join(", ");

export function ruleText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return (value as string[]).map((v) => v.trim()).filter(Boolean).join("; ");
    return (value as Partial<MatrixRow>[]).map(matrixLine).join("\n");
  }
  if (typeof value === "object" && "text" in value) {
    const v = value as { text?: string; links?: string[] };
    return [v.text?.trim(), ...(v.links ?? [])].filter(Boolean).join(" ");
  }
  return "";
}

const listOf = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[]).map((v) => v.trim()).filter(Boolean)
    : typeof value === "string"
      ? value.split(/\n|;/).map((v) => v.trim()).filter(Boolean)
      : [];

// A stable pick for this office, so a rebuild gives the same item.
function pick<T>(items: T[], seed: string): T | undefined {
  if (!items.length) return undefined;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return items[(h >>> 0) % items.length];
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export type DerivedPlaceholder = { key: string; from_key: string; rule: string };

// Every placeholder value the office has: accepted rules plus
// settings.derived_placeholders. Cards come first: a card's version wins over
// the VFDA default, and an answer the doctor or VFDA typed in wins over both.
export function placeholderValues(
  rules: RuleForBuild[],
  derived: DerivedPlaceholder[],
  seed: string,
): Record<string, string> {
  const raw = new Map<string, unknown>();
  const rank = (r: RuleForBuild) =>
    r.source === "vfda_default" ? 0 : r.source_document_id ? 1 : 2;
  for (const r of [...rules].sort((a, b) => rank(a) - rank(b))) {
    raw.set(r.rule_slot_key, r.rule);
  }
  const values: Record<string, string> = {};
  for (const [key, value] of raw) {
    const text = ruleText(value);
    if (text) values[key] = text;
  }
  for (const d of derived) {
    const source = raw.get(d.from_key);
    let text: string | undefined;
    const row = d.rule.match(/^row for (.+)$/i);
    if (row && Array.isArray(source)) {
      const want = squash(row[1]);
      const found = (source as Partial<MatrixRow>[]).find((r) => {
        const have = squash(r.visit_type ?? "");
        return have && (have.includes(want) || want.includes(have));
      });
      text = found ? matrixLine(found) : undefined;
    } else {
      // "pick one item at random": one per office (same on every rebuild).
      text = pick(listOf(source), `${seed}:${d.key}`);
    }
    if (text) values[d.key] = text;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Filling placeholders.
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;

export function placeholdersIn(value: unknown): string[] {
  const found = new Set<string>();
  for (const m of JSON.stringify(value ?? null).matchAll(PLACEHOLDER)) found.add(m[1]);
  return [...found];
}

// Fills what it can; anything without a value stays as {KEY} and is reported.
export function fill<T>(value: T, values: Record<string, string>, missing: Set<string>): T {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (whole, key: string) => {
      if (values[key] !== undefined) return values[key];
      missing.add(key);
      return whole;
    }) as T;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, values, missing)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, values, missing)])) as T;
  }
  return value;
}

export type DraftScenario = {
  scenario_id: string | null;
  office_workflow_id: string | null;
  workflow: string;
  part: string;
  part_title: string;
  code: string;
  type: ItemType;
  points: number;
  answer_format: string | null;
  stem: string;
  options: string[] | null;
  answer: string | null;
  correct_response: CorrectResponse | null;
  critical_fail: string | null;
  escalation_level: string;
  formula: string | null;
  missing_keys: string[];
  // For Claude: an options rule still to build, and whether to write a repeat.
  options_rule: string | null;
  wants_repeat: boolean;
  position: number;
  // The card (and its own words) the item was written from.
  source_card: string | null;
  source_quote: string | null;
  source_document_id: string | null;
  // A check it still fails: saved as "needs_review" for VFDA.
  review_error?: string | null;
};

export function fillMaster(m: MasterScenario, values: Record<string, string>): DraftScenario {
  const missing = new Set<string>();
  const draft: DraftScenario = {
    scenario_id: m.id,
    office_workflow_id: null,
    workflow: m.workflow,
    part: m.part,
    part_title: m.part_title,
    code: m.code,
    type: m.type,
    points: m.points,
    answer_format: m.answer_format,
    stem: fill(m.stem, values, missing),
    options: fill(m.options, values, missing),
    answer: fill(m.answer, values, missing),
    correct_response: fill(m.correct_response, values, missing),
    critical_fail: fill(m.critical_fail, values, missing),
    escalation_level: m.escalation_level,
    formula: null,
    missing_keys: [],
    options_rule: m.options_rule ? fill(m.options_rule, values, missing) : null,
    wants_repeat: m.type === "situational" && m.repeat_variant === "generate",
    position: m.position,
    source_card: null,
    source_quote: null,
    source_document_id: null,
  };
  draft.missing_keys = [...missing].sort();
  return draft;
}

// ---------------------------------------------------------------------------
// Checking what Claude wrote.
// ---------------------------------------------------------------------------

export const LETTERS = ["A", "B", "C", "D"];

// Multiple choice: four different, non-empty options and a letter A-D.
export function checkMc(options: unknown, answer: unknown): string | null {
  if (!Array.isArray(options) || options.length !== 4) return "needs exactly 4 options";
  const texts = options.map((o) => (typeof o === "string" ? o.trim() : ""));
  if (texts.some((t) => !t)) return "an option is empty";
  if (new Set(texts.map((t) => t.toLowerCase())).size !== 4) return "options repeat";
  if (typeof answer !== "string" || !LETTERS.includes(answer.trim().toUpperCase())) return "answer must be A, B, C or D";
  return null;
}

export const hasPlaceholder = (value: unknown) => placeholdersIn(value).length > 0;

// Correct response as the editor shows it: one step per line, or
// "Say:" / "Do:" / "Book:" headings with their steps below.
export function correctResponseToText(cr: CorrectResponse | null): string {
  if (!cr) return "";
  if (Array.isArray(cr)) return cr.join("\n");
  return Object.entries(cr)
    .map(([k, steps]) => `${k}:\n${steps.join("\n")}`)
    .join("\n\n");
}

export function correctResponseFromText(text: string, keys: string[] | null): CorrectResponse | string {
  const lines = text.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim());
  if (!keys) {
    const steps = lines.filter(Boolean);
    return steps.length ? steps : "Write at least one step.";
  }
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of lines) {
    if (!line) continue;
    const heading = keys.find((k) => line.toLowerCase() === `${k.toLowerCase()}:`);
    if (heading) current = heading;
    else if (!current) return `Start with one of these headings: ${keys.map((k) => `${k}:`).join(" ")}`;
    else (out[current] ??= []).push(line);
  }
  const empty = keys.filter((k) => !out[k]?.length);
  return empty.length ? `Add at least one step under ${empty.map((k) => `${k}:`).join(", ")}` : out;
}

// ---------------------------------------------------------------------------
// Card-first items: Claude's items for a day become drafts in the day's own
// master slots (same codes, parts and points), matched by type and, where it
// says so, by the master item it follows (one of the day's pool: its own, or
// one moved in from another day by the day rules).
// ---------------------------------------------------------------------------

// Never about exact buttons or click paths: the VA says it in their own words.
export const BUTTON_WORDS = /\b(click(s|ed|ing)?|button(s)?)\b/i;

export type CardItem = {
  based_on: string | null;
  type: ItemType;
  workflow: string;
  part_title: string;
  stem: string;
  options: string[] | null;
  answer: string | null;
  correct_response: CorrectResponse | null;
  critical_fail: string | null;
  escalation_level: "none" | "approval" | "immediate";
  source_card: string;
  source_quote: string;
  source_document_id: string | null;
  // Set when the item still failed its checks: saved as "needs_review".
  review_error: string | null;
};

export function cardDrafts(items: CardItem[], slots: DraftScenario[], pool: DraftScenario[] = slots): DraftScenario[] {
  const free = [...slots];
  const take = (item: CardItem) => {
    let i = free.findIndex((m) => m.code === item.based_on && m.type === item.type);
    if (i < 0) i = free.findIndex((m) => m.type === item.type);
    return i < 0 ? undefined : free.splice(i, 1)[0];
  };
  const used = new Set<string>();
  return items.map((item, n) => {
    const slot = take(item);
    const base = pool.find((m) => m.code === item.based_on && m.type === item.type && !used.has(m.code));
    if (base) used.add(base.code);
    return {
      scenario_id: base?.scenario_id ?? null,
      office_workflow_id: null,
      workflow: item.workflow,
      part: slot?.part ?? "A",
      part_title: item.part_title || slot?.part_title || "",
      code: slot?.code ?? `C${n + 1}`,
      type: item.type,
      points: item.type === "mc" ? 1 : 2,
      answer_format: item.type === "describe" ? null : (slot?.answer_format ?? null),
      stem: item.stem,
      options: item.type === "mc" ? item.options : null,
      answer: item.type === "mc" ? item.answer : null,
      correct_response: item.type === "mc" ? null : item.correct_response,
      critical_fail: item.type === "describe" ? null : item.critical_fail,
      escalation_level: item.type === "describe" ? "none" : item.escalation_level,
      formula: null,
      missing_keys: [],
      options_rule: null,
      // No immediate repeat for multiple choice or describe items.
      wants_repeat: item.type === "situational",
      position: slot?.position ?? n,
      source_card: item.source_card,
      source_quote: item.source_quote,
      source_document_id: item.source_document_id,
      review_error: item.review_error,
    };
  });
}

// The boxes a correct response is split into for this day (e.g. Say/Do/Book),
// from the master items; null when they're plain step lists.
export function responseBoxes(masters: { type: string; correct_response: CorrectResponse | null }[]): string[] | null {
  for (const m of masters) {
    if (m.type === "situational" && m.correct_response && !Array.isArray(m.correct_response)) return Object.keys(m.correct_response);
  }
  return null;
}

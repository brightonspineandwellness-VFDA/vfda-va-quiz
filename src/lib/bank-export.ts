// The office's scenario bank with answers, as pure functions: one item's
// status, the filters, and the CSV export (answer key included). No
// server-only imports, so tests can load it. VFDA only, and the office's
// doctors read-only when VFDA shares it; never served to VAs.

import { correctResponseToText, LETTERS, type CorrectResponse } from "@/lib/scenario-build";

export type BankStatus = "draft" | "needs_review" | "approved";
export const BANK_STATUS_LABELS: Record<BankStatus, string> = { draft: "Draft", needs_review: "Needs review", approved: "Approved" };

export type BankItem = {
  id: string;
  day: string;
  code: string;
  workflow: string;
  type: "mc" | "situational" | "describe";
  points: number;
  stem: string;
  options: string[] | null;
  answer: string | null;
  correct_response: CorrectResponse | null;
  critical_fail: string | null;
  escalation_level: string;
  source_card: string | null;
  source_quote: string | null;
  build_version: number;
  status: BankStatus;
  review_error: string | null;
  missing_keys: string[];
  // The immediate repeat shown after a miss, and the retake versions VAs got.
  repeat: { id: string; stem: string } | null;
  retakes: string[];
};

export type BankFilters = { day?: string; type?: string; card?: string; status?: string; review?: boolean; q?: string };

// test_status as the bank shows it: live is approved.
export const bankStatus = (testStatus: string): BankStatus =>
  testStatus === "live" ? "approved" : testStatus === "needs_review" ? "needs_review" : "draft";

const haystack = (i: BankItem) =>
  [i.code, i.stem, ...(i.options ?? []), correctResponseToText(i.correct_response), i.critical_fail ?? "", i.source_card ?? "", i.source_quote ?? "", i.repeat?.stem ?? ""]
    .join("\n")
    .toLowerCase();

export function filterBank(items: BankItem[], f: BankFilters): BankItem[] {
  const q = f.q?.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!f.day || i.day === f.day) &&
      (!f.type || i.type === f.type) &&
      (!f.card || (f.card === "(none)" ? !i.source_card : i.source_card === f.card)) &&
      (!f.status || i.status === f.status) &&
      (!f.review || i.status === "needs_review") &&
      (!q || haystack(i).includes(q)),
  );
}

// The right option, written out ("B) Text").
export const rightOption = (i: Pick<BankItem, "options" | "answer">) => {
  const n = i.answer ? LETTERS.indexOf(i.answer) : -1;
  return n >= 0 && i.options?.[n] ? `${i.answer}) ${i.options[n]}` : "";
};

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quoted when needed; a leading = + - @ can't start a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const BANK_CSV_COLUMNS = [
  "Day",
  "Version",
  "Code",
  "Workflow",
  "Type",
  "Points",
  "Status",
  "Question",
  "Options",
  "Correct answer",
  "Correct response / key points",
  "Critical fail",
  "Escalation",
  "Source card",
  "Source quote",
  "Repeat variant",
  "Retake versions",
] as const;

export function bankCsv(items: BankItem[]): string {
  const rows = items.map((i) =>
    [
      i.day,
      i.build_version,
      i.code,
      i.workflow,
      i.type,
      i.points,
      BANK_STATUS_LABELS[i.status],
      i.stem,
      (i.options ?? []).map((o, n) => `${LETTERS[n]}) ${o}`).join("\n"),
      rightOption(i),
      correctResponseToText(i.correct_response),
      i.critical_fail ?? "",
      i.escalation_level,
      i.source_card ?? "",
      i.source_quote ?? "",
      i.repeat?.stem ?? "",
      i.retakes.join("\n---\n"),
    ]
      .map(csvCell)
      .join(","),
  );
  // A byte order mark so spreadsheets read it as UTF-8.
  return `\uFEFF${[BANK_CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

// The page's filters from its query string.
export function bankFilters(params: Record<string, string | string[] | undefined>): BankFilters {
  const one = (k: string) => {
    const v = params[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s.slice(0, 200) : undefined;
  };
  return { day: one("day"), type: one("type"), card: one("card"), status: one("status"), review: one("review") === "1", q: one("q") };
}

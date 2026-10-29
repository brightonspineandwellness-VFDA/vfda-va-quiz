// Reads and checks seed/quiz-bank.json, and turns it into table rows.
// Pure functions: no database, no network. Used by scripts/import-bank.mjs.
import { readFileSync } from "node:fs";

// Everything that isn't one of the three main arrays goes into public.settings.
export const SETTINGS_KEYS = [
  "conditions",
  "derived_placeholders",
  "gray_card_questions",
  "gray_formulas",
  "gray_split",
  "gray_fill_rule",
  "gray_checklist",
  "grading",
  "sequence",
  "skipped_day_rule",
];

const ANSWER_TYPES = ["text", "list", "yesno", "upload", "matrix", "click_path", "choice"];
const ANSWER_FORMATS = ["steps_say_doc", "say_do_book"];
const SAY_DO_BOOK = ["Say", "Do", "Book"];
const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;

// Item fields that can contain {PLACEHOLDERS}.
const ITEM_TEXT_FIELDS = ["stem", "options", "options_rule", "answer", "look_for", "critical_fail"];

export function loadBank(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export const itemKey = (q) => `${q.quiz} ${q.code} v${q.version ?? "A"}`;

const isStringList = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim());

// Returns a list of problems. An empty list means the bank is safe to import.
export function validateBank(bank) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  for (const key of ["interview_questions", "quiz_templates", "question_templates", ...SETTINGS_KEYS]) {
    if (bank[key] === undefined) err(`Missing top-level "${key}"`);
  }
  if (errors.length) return errors;

  const conditions = new Set(Object.keys(bank.conditions));
  const checkCondition = (where, c) => {
    if (!conditions.has(c ?? "always")) err(`${where}: unknown condition "${c}"`);
  };

  const quizCodes = new Set();
  for (const t of bank.quiz_templates) {
    const where = `Quiz ${t.code}`;
    if (quizCodes.has(t.code)) err(`${where}: duplicate quiz code`);
    quizCodes.add(t.code);
    if (![1, 2].includes(t.week) || !(t.day >= 1 && t.day <= 5)) err(`${where}: bad week/day ${t.week}/${t.day}`);
    if (!t.title) err(`${where}: missing title`);
    if (!ANSWER_FORMATS.includes(t.answer_format)) err(`${where}: bad answer_format "${t.answer_format}"`);
    checkCondition(where, t.condition);
    const pts = [t.max_points, t.pass_points, t.review_min_points];
    const allSet = pts.every((p) => Number.isInteger(p));
    const allNull = pts.every((p) => p === null || p === undefined);
    if (!allSet && !allNull) err(`${where}: max/pass/review points must all be set or all be null`);
    if (allSet && !(t.review_min_points <= t.pass_points && t.pass_points <= t.max_points)) {
      err(`${where}: points must be review_min <= pass <= max`);
    }
  }
  for (const code of bank.sequence) if (!quizCodes.has(code)) err(`sequence: unknown quiz "${code}"`);

  const interviewKeys = new Set();
  for (const q of bank.interview_questions) {
    const where = `Interview ${q.key}`;
    if (!q.key) err(`Interview question without a key: "${q.question}"`);
    if (interviewKeys.has(q.key)) err(`${where}: duplicate key`);
    interviewKeys.add(q.key);
    if (!q.question) err(`${where}: missing question`);
    if (!ANSWER_TYPES.includes(q.answer_type)) err(`${where}: bad answer_type "${q.answer_type}"`);
    if (q.quiz !== "PROFILE" && !quizCodes.has(q.quiz)) err(`${where}: unknown quiz "${q.quiz}"`);
    checkCondition(where, q.condition);
  }

  const itemKeys = new Set();
  for (const q of bank.question_templates) {
    const where = `Item ${itemKey(q)}`;
    if (itemKeys.has(itemKey(q))) err(`${where}: duplicate quiz + code + version`);
    itemKeys.add(itemKey(q));
    if (!quizCodes.has(q.quiz)) err(`${where}: unknown quiz`);
    if (!q.code || !q.part || !q.stem) err(`${where}: missing code, part or stem`);
    if (!["A", "B"].includes(q.version ?? "A")) err(`${where}: bad version "${q.version}"`);
    if (![1, 2].includes(q.points)) err(`${where}: points must be 1 or 2`);
    if (q.answer_format != null && !ANSWER_FORMATS.includes(q.answer_format)) {
      err(`${where}: bad answer_format "${q.answer_format}"`);
    }
    checkCondition(where, q.condition);

    if (q.type === "mc") {
      const hasOptions = isStringList(q.options);
      const hasRule = typeof q.options_rule === "string" && q.options_rule.trim() !== "";
      if (hasOptions === hasRule) err(`${where}: multiple choice needs options or options_rule (exactly one)`);
      if (typeof q.answer !== "string" || !q.answer.trim()) err(`${where}: multiple choice needs an answer`);
    } else if (q.type === "situational") {
      const lf = q.look_for;
      const isList = isStringList(lf);
      // Say/Do/Book: each part is a list; a part may be empty (e.g. nothing to book).
      const isSayDoBook =
        lf && typeof lf === "object" && !Array.isArray(lf) &&
        Object.keys(lf).length === SAY_DO_BOOK.length &&
        SAY_DO_BOOK.every((k) => Array.isArray(lf[k]) && (lf[k].length === 0 || isStringList(lf[k]))) &&
        SAY_DO_BOOK.some((k) => lf[k].length > 0);
      if (!isList && !isSayDoBook) err(`${where}: look_for must be a list of points or {Say, Do, Book} lists`);
    } else {
      err(`${where}: type must be mc or situational, got "${q.type}"`);
    }
  }

  return errors;
}

// Placeholders used in items that aren't an interview key, a derived placeholder or a gray card key.
export function findUnknownPlaceholders(bank) {
  const known = new Set([
    ...bank.interview_questions.map((q) => q.key),
    ...bank.derived_placeholders.map((d) => d.key),
    ...bank.gray_card_questions.map((g) => g.key),
  ]);
  const unknown = [];
  for (const q of bank.question_templates) {
    for (const field of ITEM_TEXT_FIELDS) {
      for (const key of placeholdersIn(q[field])) {
        if (!known.has(key)) unknown.push({ item: itemKey(q), field, key });
      }
    }
  }
  return unknown;
}

export function placeholdersIn(value) {
  if (typeof value === "string") return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]);
  if (Array.isArray(value)) return value.flatMap(placeholdersIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(placeholdersIn);
  return [];
}

// Rows for each table. Every row lists every column, so a re-import overwrites
// stale values instead of leaving them behind.
export function buildRows(bank) {
  const settings = [
    ...SETTINGS_KEYS.map((key) => ({ key, value: bank[key] })),
    {
      key: "bank_info",
      value: { version: bank.version, source: bank.source, placeholder_syntax: bank.placeholder_syntax },
    },
  ];

  const quizTemplates = bank.quiz_templates.map((t) => ({
    code: t.code,
    week: t.week,
    day: t.day,
    title: t.title,
    cards: t.cards ?? [],
    condition: t.condition ?? "always",
    max_points: t.max_points ?? null,
    pass_points: t.pass_points ?? null,
    review_min_points: t.review_min_points ?? null,
    answer_format: t.answer_format,
    proof_of_work: t.proof_of_work ?? [],
    notes: t.notes ?? "",
  }));

  const interviewQuestions = bank.interview_questions.map((q, i) => ({
    key: q.key,
    quiz: q.quiz,
    question: q.question,
    answer_type: q.answer_type,
    condition: q.condition ?? "always",
    source: q.source ?? "",
    position: i,
  }));

  const positionInQuiz = {};
  const questionTemplates = bank.question_templates.map((q) => ({
    quiz_code: q.quiz, // swapped for quiz_template_id at import time
    part: q.part,
    part_title: q.part_title ?? "",
    condition: q.condition ?? "always",
    code: q.code,
    version: q.version ?? "A",
    type: q.type,
    stem: q.stem,
    options: q.options ?? null,
    options_rule: q.options_rule ?? null,
    answer: q.answer ?? null,
    look_for: q.look_for ?? null,
    critical_fail: q.critical_fail ?? null,
    bank_ref: q.bank_ref ?? "",
    points: q.points,
    answer_format: q.answer_format ?? null,
    position: (positionInQuiz[q.quiz] = (positionInQuiz[q.quiz] ?? -1) + 1),
  }));

  return { settings, quizTemplates, interviewQuestions, questionTemplates };
}

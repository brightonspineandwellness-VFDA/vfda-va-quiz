// Reads and checks seed/quiz-bank-v2.json, and turns it into table rows.
// Pure functions: no database, no network. Used by scripts/import-bank.mjs.
import { readFileSync } from "node:fs";

// The four arrays that get their own tables. Everything else goes into
// public.settings: one row per key, except the bank's descriptive fields,
// which are grouped as "bank_info".
export const TABLE_KEYS = ["workflows", "rule_slots", "schedule", "scenarios"];
export const INFO_KEYS = ["version", "date", "model", "placeholder_syntax"];
export const REQUIRED_SETTINGS = ["conditions", "sequence", "derived_placeholders", "gray_card_questions", "card_groups"];

const WORKFLOW_LISTS = [
  "required_information",
  "steps",
  "va_can_decide",
  "requires_approval",
  "immediate_escalation",
  "common_mistakes",
  "prohibited_actions",
  "sop_outline",
  "bank_refs",
  "rule_keys",
  "test_scenarios",
];
const WORKFLOW_TEXTS = ["trigger", "definition_of_done", "pass_standard"];
const ANSWER_TYPES = ["text", "list", "yesno", "choice", "upload", "matrix"];
export const TIERS = ["profile", "auto", "default", "doctor"];
const ANSWER_FORMATS = ["steps_say_doc", "say_do_book"];
const ESCALATION_LEVELS = ["none", "approval", "immediate"];
const TEST_STATUSES = ["draft", "vfda_reviewed", "live"];
const SAY_DO_BOOK = ["Say", "Do", "Book"];
const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;

// Scenario fields that can contain {PLACEHOLDERS}.
const SCENARIO_TEXT_FIELDS = ["stem", "options", "options_rule", "answer", "correct_response", "critical_fail"];

export function loadBank(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export const scenarioKey = (s) => `${s.schedule_day} ${s.code} v${s.version ?? "A"}`;

const isText = (v) => typeof v === "string" && v.trim() !== "";
const isStringList = (v) => Array.isArray(v) && v.every(isText);
const isFilledList = (v) => isStringList(v) && v.length > 0;

// Returns a list of problems. An empty list means the bank is safe to import.
export function validateBank(bank) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  for (const key of [...TABLE_KEYS, ...REQUIRED_SETTINGS]) {
    if (bank[key] === undefined) err(`Missing top-level "${key}"`);
  }
  for (const key of TABLE_KEYS) {
    if (bank[key] !== undefined && !Array.isArray(bank[key])) err(`"${key}" must be a list`);
  }
  if (errors.length) return errors;

  const conditions = new Set(Object.keys(bank.conditions));
  const checkCondition = (where, c) => {
    if (!conditions.has(c ?? "always")) err(`${where}: unknown condition "${c}"`);
  };
  const unique = (where, seen, key) => {
    if (seen.has(key)) err(`${where}: duplicate`);
    seen.add(key);
  };

  // Workflows
  const workflowCodes = new Set();
  for (const w of bank.workflows) {
    const where = `Workflow ${w.code}`;
    if (!/^WF\d{2}$/.test(w.code ?? "")) err(`${where}: code must look like WF01`);
    unique(where, workflowCodes, w.code);
    if (!isText(w.name)) err(`${where}: missing name`);
    for (const f of WORKFLOW_TEXTS) if (typeof w[f] !== "string") err(`${where}: "${f}" must be text`);
    for (const f of WORKFLOW_LISTS) if (!isStringList(w[f] ?? [])) err(`${where}: "${f}" must be a list of text`);
  }

  // Training days
  const dayCodes = new Set();
  for (const d of bank.schedule) {
    const where = `Day ${d.code}`;
    unique(where, dayCodes, d.code);
    if (![1, 2].includes(d.week) || !(d.day >= 1 && d.day <= 5)) err(`${where}: bad week/day ${d.week}/${d.day}`);
    if (d.code !== `W${d.week}D${d.day}`) err(`${where}: code doesn't match week ${d.week} day ${d.day}`);
    if (!isText(d.title)) err(`${where}: missing title`);
    if (!ANSWER_FORMATS.includes(d.answer_format)) err(`${where}: bad answer_format "${d.answer_format}"`);
    checkCondition(where, d.condition);
    const pts = [d.max_points, d.pass_points, d.review_min_points];
    const allSet = pts.every((p) => Number.isInteger(p));
    const allNull = pts.every((p) => p === null || p === undefined);
    if (!allSet && !allNull) err(`${where}: max/pass/review points must all be set or all be null`);
    if (allSet && !(d.review_min_points <= d.pass_points && d.pass_points <= d.max_points)) {
      err(`${where}: points must be review_min <= pass <= max`);
    }
    for (const f of ["cards", "proof_of_work", "workflows"]) {
      if (!isStringList(d[f] ?? [])) err(`${where}: "${f}" must be a list of text`);
    }
    for (const code of d.workflows ?? []) if (!workflowCodes.has(code)) err(`${where}: unknown workflow "${code}"`);
  }
  for (const code of bank.sequence) if (!dayCodes.has(code)) err(`sequence: unknown day "${code}"`);

  // Rule slots
  const slotKeys = new Set();
  for (const r of bank.rule_slots) {
    const where = `Rule slot ${r.key}`;
    if (!/^[A-Z][A-Z0-9_]*$/.test(r.key ?? "")) err(`Rule slot with a bad key: "${r.key}"`);
    unique(where, slotKeys, r.key);
    if (!isText(r.question)) err(`${where}: missing question`);
    if (!ANSWER_TYPES.includes(r.answer_type)) err(`${where}: bad answer_type "${r.answer_type}"`);
    if (r.schedule_day !== "PROFILE" && !dayCodes.has(r.schedule_day)) err(`${where}: unknown day "${r.schedule_day}"`);
    checkCondition(where, r.condition);
    if (!isStringList(r.workflows ?? [])) err(`${where}: "workflows" must be a list`);
    for (const code of r.workflows ?? []) if (!workflowCodes.has(code)) err(`${where}: unknown workflow "${code}"`);
    if (!TIERS.includes(r.tier)) err(`${where}: tier must be one of ${TIERS.join(", ")}, got "${r.tier}"`);
    if (r.tier === "profile" && r.schedule_day !== "PROFILE") err(`${where}: profile tier must be on PROFILE`);
    if (r.tier === "default" && (r.default_answer === null || r.default_answer === undefined)) {
      err(`${where}: default tier needs a default_answer`);
    }
    if (r.tier !== "default" && r.default_answer != null) err(`${where}: only default-tier slots have a default_answer`);
    if (r.suggested_answer != null && r.tier !== "doctor") err(`${where}: only doctor-tier slots have a suggested_answer`);
    if (r.tier === "auto" && !isText(r.auto_rule)) err(`${where}: auto tier needs an auto_rule`);
    if (r.tier === "doctor" && !(bank.card_groups?.[r.card_group] ?? []).includes(r.key)) {
      err(`${where}: doctor tier needs a card_group that lists it (got "${r.card_group}")`);
    }
  }
  for (const [group, keys] of Object.entries(bank.card_groups ?? {})) {
    for (const key of keys) {
      const slot = bank.rule_slots.find((r) => r.key === key);
      if (slot?.tier !== "doctor" || slot.card_group !== group) err(`card_groups "${group}": ${key} isn't a doctor-tier slot in this group`);
    }
  }

  // Scenarios
  const scenarioKeys = new Set();
  for (const s of bank.scenarios) {
    const where = `Scenario ${scenarioKey(s)}`;
    unique(where, scenarioKeys, scenarioKey(s));
    if (!dayCodes.has(s.schedule_day)) err(`${where}: unknown day`);
    if (!workflowCodes.has(s.workflow)) err(`${where}: unknown workflow "${s.workflow}"`);
    if (!isText(s.code) || !isText(s.part) || !isText(s.stem)) err(`${where}: missing code, part or stem`);
    if (!["A", "B"].includes(s.version ?? "A")) err(`${where}: bad version "${s.version}"`);
    if (![1, 2].includes(s.points)) err(`${where}: points must be 1 or 2`);
    if (s.answer_format != null && !ANSWER_FORMATS.includes(s.answer_format)) {
      err(`${where}: bad answer_format "${s.answer_format}"`);
    }
    if (!ESCALATION_LEVELS.includes(s.escalation_level ?? "none")) err(`${where}: bad escalation_level "${s.escalation_level}"`);
    if (!TEST_STATUSES.includes(s.test_status ?? "draft")) err(`${where}: bad test_status "${s.test_status}"`);
    checkCondition(where, s.condition);

    if (s.type === "mc") {
      const hasOptions = isFilledList(s.options);
      const hasRule = isText(s.options_rule);
      if (hasOptions === hasRule) err(`${where}: multiple choice needs options or options_rule (exactly one)`);
      if (!isText(s.answer)) err(`${where}: multiple choice needs an answer`);
    } else if (s.type === "situational") {
      const cr = s.correct_response;
      // Say/Do/Book: each part is a list; a part may be empty (e.g. nothing to book).
      const isSayDoBook =
        cr && typeof cr === "object" && !Array.isArray(cr) &&
        Object.keys(cr).length === SAY_DO_BOOK.length &&
        SAY_DO_BOOK.every((k) => isStringList(cr[k])) &&
        SAY_DO_BOOK.some((k) => cr[k].length > 0);
      if (!isFilledList(cr) && !isSayDoBook) {
        err(`${where}: correct_response must be a list of steps or {Say, Do, Book} lists`);
      }
    } else {
      err(`${where}: type must be mc or situational, got "${s.type}"`);
    }
  }

  // Workflows point at scenarios as "<day>-<code>".
  const refs = new Set(bank.scenarios.map((s) => `${s.schedule_day}-${s.code}`));
  for (const w of bank.workflows) {
    for (const ref of w.test_scenarios ?? []) {
      if (!refs.has(ref)) err(`Workflow ${w.code}: test scenario "${ref}" not found`);
    }
  }

  return errors;
}

// Every key that can fill a {PLACEHOLDER}.
export function knownPlaceholders(bank) {
  return new Set([
    ...bank.rule_slots.map((r) => r.key),
    ...bank.derived_placeholders.map((d) => d.key),
    ...bank.gray_card_questions.map((g) => g.key),
    ...(bank.office_fields ?? []).map((f) => f.key),
  ]);
}

// Placeholders (and workflow rule keys) that aren't a rule slot, a derived
// placeholder, a gray card key or an office field.
export function findUnknownPlaceholders(bank) {
  const known = knownPlaceholders(bank);
  const unknown = [];
  for (const s of bank.scenarios) {
    for (const field of SCENARIO_TEXT_FIELDS) {
      for (const key of placeholdersIn(s[field])) {
        if (!known.has(key)) unknown.push({ where: `Scenario ${scenarioKey(s)}`, field, key });
      }
    }
  }
  for (const w of bank.workflows) {
    for (const field of [...WORKFLOW_TEXTS, ...WORKFLOW_LISTS.filter((f) => f !== "rule_keys")]) {
      for (const key of placeholdersIn(w[field])) {
        if (!known.has(key)) unknown.push({ where: `Workflow ${w.code}`, field, key });
      }
    }
    for (const key of w.rule_keys ?? []) {
      if (!known.has(key)) unknown.push({ where: `Workflow ${w.code}`, field: "rule_keys", key });
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
    ...Object.keys(bank)
      .filter((key) => !TABLE_KEYS.includes(key) && !INFO_KEYS.includes(key))
      .map((key) => ({ key, value: bank[key] })),
    { key: "bank_info", value: Object.fromEntries(INFO_KEYS.map((k) => [k, bank[k] ?? null])) },
    // JSON objects don't keep key order in Postgres, so the screen order of
    // card_groups is saved as its own list.
    { key: "card_group_order", value: Object.keys(bank.card_groups ?? {}) },
  ];

  const workflows = bank.workflows.map((w, i) => ({
    code: w.code,
    name: w.name,
    ...Object.fromEntries(WORKFLOW_TEXTS.map((f) => [f, w[f] ?? ""])),
    ...Object.fromEntries(WORKFLOW_LISTS.map((f) => [f, w[f] ?? []])),
    position: i,
  }));

  // Upload answers are {text, links}; one written as plain text becomes the text.
  const asAnswer = (r, value) =>
    r.answer_type === "upload" && typeof value === "string" ? { text: value, links: [] } : (value ?? null);

  const ruleSlots = bank.rule_slots.map((r, i) => ({
    key: r.key,
    question: r.question,
    answer_type: r.answer_type,
    condition: r.condition ?? "always",
    card_source: r.card_source ?? "",
    workflows: r.workflows ?? [],
    schedule_day: r.schedule_day,
    tier: r.tier,
    default_answer: asAnswer(r, r.default_answer),
    // Shown to the doctor as a starting point; never accepted on their behalf.
    suggested_answer: asAnswer(r, r.suggested_answer),
    auto_rule: r.auto_rule ?? null,
    card_group: r.card_group ?? null,
    position: i,
  }));

  const scheduleDays = bank.schedule.map((d) => ({
    code: d.code,
    week: d.week,
    day: d.day,
    title: d.title,
    cards: d.cards ?? [],
    condition: d.condition ?? "always",
    max_points: d.max_points ?? null,
    pass_points: d.pass_points ?? null,
    review_min_points: d.review_min_points ?? null,
    answer_format: d.answer_format,
    proof_of_work: d.proof_of_work ?? [],
    workflows: d.workflows ?? [],
    notes: d.notes ?? "",
  }));

  const positionInDay = {};
  const scenarios = bank.scenarios.map((s) => ({
    schedule_day: s.schedule_day,
    code: s.code,
    version: s.version ?? "A",
    workflow: s.workflow,
    part: s.part,
    part_title: s.part_title ?? "",
    condition: s.condition ?? "always",
    type: s.type,
    stem: s.stem,
    options: s.options ?? null,
    options_rule: s.options_rule ?? null,
    answer: s.answer ?? null,
    correct_response: s.correct_response ?? null,
    critical_fail: s.critical_fail ?? null,
    escalation_level: s.escalation_level ?? "none",
    bank_ref: s.bank_ref ?? "",
    points: s.points,
    answer_format: s.answer_format ?? null,
    repeat_variant: s.repeat_variant ?? null,
    test_status: s.test_status ?? "draft",
    position: (positionInDay[s.schedule_day] = (positionInDay[s.schedule_day] ?? -1) + 1),
  }));

  return { settings, workflows, ruleSlots, scheduleDays, scenarios };
}

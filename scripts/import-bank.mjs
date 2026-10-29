// Imports seed/quiz-bank.json into Supabase. Safe to run again: rows are matched
// by quiz code, interview key, quiz code + item code + version, or settings key,
// and updated in place. Nothing is ever duplicated or deleted.
//
// Usage (from your computer only):
//   npm run import:bank              check the bank, then import it
//   npm run import:bank -- --dry-run check the bank only, no database
//
// Uses SUPABASE_SERVICE_ROLE_KEY from .env.local. This file lives outside src/,
// so it's never part of the web app or sent to a browser.
import { createClient } from "@supabase/supabase-js";
import {
  buildRows,
  findUnknownPlaceholders,
  itemKey,
  loadBank,
  validateBank,
} from "./lib/bank.mjs";

const BANK_PATH = "seed/quiz-bank.json";
const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (process.env.VERCEL || process.env.CI) {
  fail("import:bank runs only from your own computer, not on Vercel or CI.");
}

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fine for --dry-run; checked below for a real import.
}

// 1. Check the bank
const bank = loadBank(BANK_PATH);
console.log(`Quiz bank ${bank.version} (${BANK_PATH})`);

const errors = validateBank(bank);
if (errors.length) {
  console.error(`\n${errors.length} problem(s) in the bank; nothing was imported:`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log("✓ Bank structure is valid");

const unknown = findUnknownPlaceholders(bank);
if (unknown.length === 0) {
  console.log("✓ Unknown placeholders: none");
} else {
  console.log(`! Unknown placeholders (${unknown.length}): not an interview key, derived placeholder or gray card key`);
  unknown.forEach((u) => console.log(`    {${u.key}}  in ${u.item} (${u.field})`));
}

const rows = buildRows(bank);
console.log(
  `  ${rows.quizTemplates.length} quizzes, ${rows.questionTemplates.length} items, ` +
    `${rows.interviewQuestions.length} interview questions, ${rows.settings.length} settings`,
);
const withRule = rows.questionTemplates.filter((q) => q.options_rule).length;
console.log(`  ${withRule} multiple-choice items use options_rule (options built per office in Phase 4)`);

if (dryRun) {
  console.log("\nDry run: database not touched.");
  process.exit(0);
}

// 2. Import
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function check(step, error) {
  if (!error) return;
  let hint = "";
  if (error.code === "PGRST205" || error.code === "42P01") hint = "\n  Run supabase/phase1.sql in the SQL Editor first.";
  if (error.code === "23502" && /points/.test(error.message)) hint = "\n  Run supabase/phase2.sql in the SQL Editor first.";
  fail(`${step} failed: ${error.message}${hint}`);
}

// Existing keys, to report new vs updated and rows no longer in the bank.
async function existing(table, columns) {
  const { data, error } = await supabase.from(table).select(columns);
  check(`Reading ${table}`, error);
  return data;
}

function report(label, bankKeys, dbKeys) {
  const inDb = new Set(dbKeys);
  const inBank = new Set(bankKeys);
  const added = bankKeys.filter((k) => !inDb.has(k)).length;
  const stale = dbKeys.filter((k) => !inBank.has(k));
  console.log(`  ${label.padEnd(20)} ${String(added).padStart(3)} new, ${String(bankKeys.length - added).padStart(3)} updated`);
  stale.forEach((k) => console.log(`    ! ${k} is in the database but no longer in the bank (left as is)`));
}

console.log(`\nImporting into ${new URL(url).host} ...`);

const beforeSettings = await existing("settings", "key");
const beforeQuizzes = await existing("quiz_templates", "id, code");
const beforeInterview = await existing("interview_questions", "key");
const beforeItems = await existing("question_templates", "code, version, quiz_template_id");

{
  const { error } = await supabase.from("settings").upsert(rows.settings, { onConflict: "key" });
  check("Saving settings", error);
}

const { data: quizzes, error: quizError } = await supabase
  .from("quiz_templates")
  .upsert(rows.quizTemplates, { onConflict: "code" })
  .select("id, code");
check("Saving quiz templates", quizError);
const quizIdByCode = Object.fromEntries(quizzes.map((q) => [q.code, q.id]));

{
  const { error } = await supabase
    .from("interview_questions")
    .upsert(rows.interviewQuestions, { onConflict: "key" });
  check("Saving interview questions", error);
}

{
  const items = rows.questionTemplates.map(({ quiz_code, ...item }) => ({
    ...item,
    quiz_template_id: quizIdByCode[quiz_code],
  }));
  const { error } = await supabase
    .from("question_templates")
    .upsert(items, { onConflict: "quiz_template_id,code,version" });
  check("Saving items", error);
}

// 3. Report
const codeById = Object.fromEntries([...beforeQuizzes, ...quizzes].map((q) => [q.id, q.code]));
console.log("\nDone:");
report("settings", rows.settings.map((s) => s.key), beforeSettings.map((s) => s.key));
report("quiz_templates", rows.quizTemplates.map((q) => q.code), beforeQuizzes.map((q) => q.code));
report("interview_questions", rows.interviewQuestions.map((q) => q.key), beforeInterview.map((q) => q.key));
report(
  "question_templates",
  rows.questionTemplates.map((q) => itemKey({ quiz: q.quiz_code, code: q.code, version: q.version })),
  beforeItems.map((q) => itemKey({ quiz: codeById[q.quiz_template_id], code: q.code, version: q.version })),
);

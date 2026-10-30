// Imports seed/quiz-bank-v2.json into Supabase. Safe to run again: rows are
// matched by workflow code, rule slot key, day code, day + scenario code +
// version, or settings key, and updated in place. Nothing is ever duplicated
// or deleted.
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
  loadBank,
  scenarioKey,
  validateBank,
} from "./lib/bank.mjs";

const BANK_PATH = "seed/quiz-bank-v2.json";
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
  console.log(
    `! Unknown placeholders (${unknown.length}): not a rule slot, derived placeholder, gray card key or office field`,
  );
  unknown.forEach((u) => console.log(`    {${u.key}}  in ${u.where} (${u.field})`));
}

const rows = buildRows(bank);
console.log(
  `  ${rows.workflows.length} workflows, ${rows.ruleSlots.length} rule slots, ` +
    `${rows.scheduleDays.length} training days, ${rows.scenarios.length} scenarios, ${rows.settings.length} settings`,
);
const tiers = Object.fromEntries(
  ["profile", "doctor", "default", "auto"].map((t) => [t, rows.ruleSlots.filter((r) => r.tier === t).length]),
);
console.log(
  `  rule tiers: ${tiers.profile} profile, ${tiers.doctor} doctor (in ${Object.keys(bank.card_groups).length} card groups), ` +
    `${tiers.default} default, ${tiers.auto} auto`,
);
const suggested = rows.ruleSlots.filter((r) => r.suggested_answer !== null).length;
console.log(`  ${suggested} doctor-tier slots have a VFDA suggestion (shown to the doctor, never auto-accepted)`);
if (bank.approvals) console.log(`  approvals stored in settings`);
const withRule = rows.scenarios.filter((s) => s.options_rule).length;
console.log(`  ${withRule} multiple-choice scenarios use options_rule (options built per office later)`);

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
  const hint =
    error.code === "PGRST205" || error.code === "42P01"
      ? "\n  Run supabase/phase2b.sql in the SQL Editor first."
      : ["PGRST204", "PGRST202", "42703", "42883"].includes(error.code)
        ? `\n  Run supabase/${/suggested_answer/.test(error.message) ? "phase2d" : "phase2c"}.sql in the SQL Editor first.`
        : "";
  fail(`${step} failed: ${error.message}${hint}`);
}

// Existing keys, to report new vs updated and rows no longer in the bank.
async function existing(table, columns, keyOf) {
  const { data, error } = await supabase.from(table).select(columns);
  check(`Reading ${table}`, error);
  return data.map(keyOf);
}

async function upsert(label, table, rowsToSave, onConflict) {
  const { error } = await supabase.from(table).upsert(rowsToSave, { onConflict });
  check(`Saving ${label}`, error);
}

function report(label, bankKeys, dbKeys) {
  const inDb = new Set(dbKeys);
  const inBank = new Set(bankKeys);
  const added = bankKeys.filter((k) => !inDb.has(k)).length;
  const stale = dbKeys.filter((k) => !inBank.has(k));
  console.log(`  ${label.padEnd(14)} ${String(added).padStart(3)} new, ${String(bankKeys.length - added).padStart(3)} updated`);
  stale.forEach((k) => console.log(`    ! ${k} is in the database but no longer in the bank (left as is)`));
}

console.log(`\nImporting into ${new URL(url).host} ...`);

const before = {
  settings: await existing("settings", "key", (r) => r.key),
  workflows: await existing("workflows", "code", (r) => r.code),
  ruleSlots: await existing("rule_slots", "key", (r) => r.key),
  scheduleDays: await existing("schedule_days", "code", (r) => r.code),
  scenarios: await existing("scenarios", "schedule_day, code, version", scenarioKey),
};

// Parents first: scenarios point at workflows and days.
await upsert("settings", "settings", rows.settings, "key");
await upsert("workflows", "workflows", rows.workflows, "code");
await upsert("training days", "schedule_days", rows.scheduleDays, "code");
await upsert("rule slots", "rule_slots", rows.ruleSlots, "key");
await upsert("scenarios", "scenarios", rows.scenarios, "schedule_day,code,version");

// Every office gets its default-tier rules (VFDA standards) and auto-tier
// rules, including any slots that are new in this import.
const { data: officeCount, error: refreshError } = await supabase.rpc("refresh_all_office_rules");
check("Filling office default and auto rules", refreshError);

// 3. Report
console.log("\nDone:");
report("settings", rows.settings.map((s) => s.key), before.settings);
report("workflows", rows.workflows.map((w) => w.code), before.workflows);
report("rule_slots", rows.ruleSlots.map((r) => r.key), before.ruleSlots);
report("schedule_days", rows.scheduleDays.map((d) => d.code), before.scheduleDays);
report("scenarios", rows.scenarios.map(scenarioKey), before.scenarios);
console.log(`  default + auto rules filled for ${officeCount} office(s)`);

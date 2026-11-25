import "server-only";

// What the AI patient and the grader know about the VA's office. Read only:
// Call practice never writes office rules.
//
// Cadence items: the office's accepted rule from its Scheduling Cadence card
// (source card import, doctor or VFDA) when it has one; otherwise VFDA's
// standard from call_cadence_standards, recorded as "vfda_standard". An office
// rule that only says "keep the VFDA default" counts as the VFDA standard.

import { ruleText } from "@/lib/scenario-build";
import { createAdminClient } from "@/lib/supabase/server";
import type { CadenceSource } from "./types";

type Db = ReturnType<typeof createAdminClient>;

// Phone scripts and the office facts a caller may ask about.
export const SCRIPT_KEYS = [
  "GREETING",
  "INBOUND_SCRIPT",
  "OUTBOUND_SCRIPT",
  "OBJECTION_SCRIPT",
  "NONGUARANTEE_SCRIPT",
  "NP_CALL_QUESTIONS",
  "CALLBACK_TIME",
  "CALL_NOTE_RULE",
  "OFFICE_HOURS",
  "SERVICES",
  "NOT_OFFERED",
  "FEE_RULE",
  "PLANS_ACCEPTED",
  "PARKING_INFO",
  "PATIENT_ID_CHECK",
  "ESCALATION_CONTACT",
] as const;

export type CadenceRule = {
  key: string;
  label: string;
  checks: string;
  value: string;
  source: CadenceSource;
  callUse: "test" | "defer";
};

export type CallContext = {
  officeName: string;
  doctorName: string | null;
  scripts: Record<string, string>; // key -> text (only keys the office has)
  cadence: CadenceRule[];
};

type RuleRow = { rule_slot_key: string; rule: unknown; source: string; effective_date: string; updated_at: string };

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// Newest accepted rule per key.
function latestByKey(rows: RuleRow[]): Map<string, RuleRow> {
  const out = new Map<string, RuleRow>();
  for (const r of rows) {
    const prev = out.get(r.rule_slot_key);
    if (!prev || `${r.effective_date}${r.updated_at}` > `${prev.effective_date}${prev.updated_at}`) out.set(r.rule_slot_key, r);
  }
  return out;
}

export async function loadCallContext(officeId: string, db: Db = createAdminClient()): Promise<CallContext> {
  const [office, standards] = await Promise.all([
    db.from("offices").select("name, doctor_name").eq("id", officeId).maybeSingle(),
    db.from("call_cadence_standards").select("rule_key, label, checks, standard, call_use, sort_order").order("sort_order"),
  ]);
  const officeRow = must(office) as { name: string; doctor_name: string | null } | null;
  if (!officeRow) throw new Error("Office not found.");
  const standardRows = (must(standards) ?? []) as {
    rule_key: string;
    label: string;
    checks: string;
    standard: string;
    call_use: "test" | "defer";
  }[];

  const keys = [...SCRIPT_KEYS, ...standardRows.map((s) => s.rule_key)];
  const rules = (must(
    await db
      .from("office_rules")
      .select("rule_slot_key, rule, source, effective_date, updated_at")
      .eq("office_id", officeId)
      .eq("status", "accepted")
      .in("rule_slot_key", keys),
  ) ?? []) as RuleRow[];
  const byKey = latestByKey(rules);

  const scripts: Record<string, string> = {};
  for (const key of SCRIPT_KEYS) {
    const text = ruleText(byKey.get(key)?.rule);
    if (text) scripts[key] = text;
  }

  const cadence = standardRows.map((s): CadenceRule => {
    const own = byKey.get(s.rule_key);
    const ownText = own && own.source !== "vfda_default" ? ruleText(own.rule) : "";
    return {
      key: s.rule_key,
      label: s.label,
      checks: s.checks,
      value: ownText || s.standard,
      source: ownText ? "office" : "vfda_standard",
      callUse: s.call_use,
    };
  });

  return { officeName: officeRow.name, doctorName: officeRow.doctor_name, scripts, cadence };
}

export const cadenceSources = (ctx: CallContext): Record<string, CadenceSource> =>
  Object.fromEntries(ctx.cadence.map((c) => [c.key, c.source]));

// The words shown on a cadence feedback line.
export const sourceLabel = (s: CadenceSource) => (s === "office" ? "Office rule" : "VFDA standard – office has no card");

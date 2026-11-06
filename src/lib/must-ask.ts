import "server-only";

// Must-ask rules no card (and nobody) covers get VFDA's suggestion, as
// accepted rules with source vfda_default; the doctor is never asked. Set
// after the cards are read, and before VFDA's report is written. Rules VFDA
// has no suggestion for stay blank (listed in the report).

import { loadOfficeSetup } from "@/lib/interview-data";
import { createAdminClient } from "@/lib/supabase/server";

export async function applyMustAskFallbacks(officeId: string) {
  const db = createAdminClient();
  const setup = await loadOfficeSetup(officeId, db as never);
  if (!setup?.fallbacks.length) return 0;
  const { error } = await db.from("office_rules").upsert(
    setup.fallbacks.map((s) => ({
      office_id: officeId,
      rule_slot_key: s.key,
      rule: s.suggested_answer,
      source: "vfda_default",
      status: "accepted",
      source_document_id: null,
    })),
    { onConflict: "office_id,rule_slot_key,source_document_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return setup.fallbacks.length;
}

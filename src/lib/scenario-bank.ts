import "server-only";

// The office's scenario bank (/admin/offices/[id]/bank): every built scenario
// with its answers, by day and build version. VFDA admins only; the office's
// doctors read-only when VFDA turned on "Share answer bank with doctor".
// Never served to VAs. Service role after the access check.

import type { CurrentUser } from "@/lib/auth";
import { bankStatus, type BankItem } from "@/lib/bank-export";
import type { CorrectResponse } from "@/lib/scenario-build";
import { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// VFDA always; a doctor of the office only when the bank is shared; never a VA.
export async function canReadBank(user: CurrentUser | null, officeId: string) {
  if (user?.role === "vfda_admin") return true;
  if (user?.role !== "doctor" || user.officeId !== officeId) return false;
  const { data } = await createAdminClient().from("offices").select("share_answer_bank").eq("id", officeId).maybeSingle();
  return !!data?.share_answer_bank;
}

type Row = {
  id: string;
  schedule_day: string;
  code: string;
  workflow: string;
  type: BankItem["type"];
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
  test_status: string;
  review_error: string | null;
  missing_keys: string[] | null;
  is_repeat_variant: boolean;
  parent_scenario_id: string | null;
  recheck: boolean;
  position: number;
  version: string;
};

const COLUMNS =
  "id, schedule_day, code, workflow, type, points, stem, options, answer, correct_response, critical_fail, escalation_level, source_card, source_quote, build_version, test_status, review_error, missing_keys, is_repeat_variant, parent_scenario_id, recheck, position, version";

export type BankDay = {
  code: string;
  title: string;
  // The latest version built, the one VAs get, and whether it's approved.
  latest: number | null;
  live: number | null;
  approved: boolean;
  items: BankItem[];
};

export async function loadBank(db: Db, officeId: string) {
  const [office, days, sequence, officeDays, rows] = await Promise.all([
    db.from("offices").select("id, name, share_answer_bank").eq("id", officeId).maybeSingle(),
    db.from("schedule_days").select("code, title"),
    db.from("settings").select("value").eq("key", "sequence").maybeSingle(),
    db.from("office_days").select("schedule_day, build_version, live_version").eq("office_id", officeId),
    db.from("office_scenarios").select(COLUMNS).eq("office_id", officeId).limit(10000),
  ]);
  const officeRow = must(office) as { id: string; name: string; share_answer_bank: boolean } | null;
  if (!officeRow) return null;
  const all = (must(rows) ?? []) as Row[];
  const byParent = (id: string) => all.filter((r) => r.parent_scenario_id === id);
  const items: BankItem[] = all
    .filter((r) => !r.is_repeat_variant && r.version === "A")
    .map((r) => {
      const repeat = byParent(r.id).find((x) => !x.recheck) ?? null;
      return {
        id: r.id,
        day: r.schedule_day,
        code: r.code,
        workflow: r.workflow,
        type: r.type,
        points: r.points,
        stem: r.stem,
        options: Array.isArray(r.options) ? r.options.map(String) : null,
        answer: r.answer,
        correct_response: r.correct_response,
        critical_fail: r.critical_fail,
        escalation_level: r.escalation_level,
        source_card: r.source_card,
        source_quote: r.source_quote,
        build_version: r.build_version ?? 1,
        status: bankStatus(r.test_status),
        review_error: r.review_error,
        missing_keys: r.missing_keys ?? [],
        repeat: repeat ? { id: repeat.id, stem: repeat.stem } : null,
        // Retake (and recheck) versions VAs were given of this item.
        retakes: byParent(r.id)
          .filter((x) => x.recheck)
          .map((x) => x.stem),
      };
    });
  const order = ((must(sequence)?.value as string[] | undefined) ?? []).reduce<Record<string, number>>((m, c, i) => ({ ...m, [c]: i }), {});
  const position = new Map(all.map((r) => [r.id, r.position]));
  items.sort(
    (a, b) =>
      (order[a.day] ?? 99) - (order[b.day] ?? 99) || b.build_version - a.build_version || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0) || a.code.localeCompare(b.code),
  );
  const titles = new Map(((must(days) ?? []) as { code: string; title: string }[]).map((d) => [d.code, d.title]));
  const status = (must(officeDays) ?? []) as { schedule_day: string; build_version: number | null; live_version: number | null }[];
  const dayCodes = [...new Set(items.map((i) => i.day))];
  const bankDays: BankDay[] = dayCodes.map((code) => {
    const s = status.find((d) => d.schedule_day === code);
    return {
      code,
      title: titles.get(code) ?? "",
      latest: s?.build_version ?? null,
      live: s?.live_version ?? null,
      approved: !!s?.live_version && s.live_version === s.build_version,
      items: items.filter((i) => i.day === code),
    };
  });
  return {
    office: officeRow,
    days: bankDays,
    items,
    cards: [...new Set(items.map((i) => i.source_card).filter((c): c is string => !!c))].sort(),
  };
}

export type Bank = NonNullable<Awaited<ReturnType<typeof loadBank>>>;

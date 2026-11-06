import "server-only";

// Workflow certifications on the server (service role): worked out again after
// every attempt, score override and SOP status change; rechecks opened here.
// Nothing else is assigned automatically. Rules: src/lib/certification.ts.

import {
  addDays,
  certStatus,
  DEFAULT_RECHECK_DAYS,
  DEFAULT_SOP_OUTLINE,
  evaluateWorkflow,
  parseTrelloLinks,
  RECHECK_ITEMS,
  type CertStatus,
  type EvidenceItem,
  type SopStatus,
} from "@/lib/certification";
import { writeRecheckVariants } from "@/lib/scenario-ai";
import { createAdminClient } from "@/lib/supabase/server";
import { percentOf, withOverride } from "@/lib/va-flow";
import { officeRulesFor } from "@/lib/va-training";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

type ScenarioRow = {
  id: string;
  workflow: string;
  office_workflow_id: string | null;
  schedule_day: string;
  version: "A" | "B";
  type: "mc" | "situational" | "describe";
  points: number;
  test_status: string;
};

type AttemptRow = {
  id: string;
  kind: "day" | "retrain" | "recheck";
  schedule_day: string;
  version: "A" | "B";
  submitted_at: string | null;
  result: string | null;
  certification_id: string | null;
  created_at: string;
};

export type CertRow = {
  id: string;
  va_id: string;
  workflow: string | null;
  office_workflow_id: string | null;
  status: CertStatus;
  sop_links: string[];
  sop_link: string | null;
  sop_status: SopStatus;
  sop_note: string | null;
  sop_submitted_at: string | null;
  sop_confirmed_at: string | null;
  certified_at: string | null;
  recheck_date: string | null;
  office_id: string;
};

export const CERT_COLUMNS =
  "id, va_id, office_id, workflow, office_workflow_id, status, sop_links, sop_link, sop_status, sop_note, sop_submitted_at, sop_confirmed_at, certified_at, recheck_date";

const settingValue = (rows: { key: string; value: unknown }[], key: string) => rows.find((r) => r.key === key)?.value;

const latestBy = <T extends { submitted_at: string | null }>(rows: T[]) =>
  rows.filter((r) => r.submitted_at).sort((a, b) => (a.submitted_at! < b.submitted_at! ? 1 : -1))[0] ?? null;

// The workflows an office trains: standard ones it has scenarios for, and its
// gray card workflows. key = the workflow code on its scenarios.
export async function officeWorkflows(db: Db, officeId: string) {
  const [workflows, gray, scenarios, sequence] = await Promise.all([
    db.from("workflows").select("code, name, pass_standard, sop_outline").order("code"),
    db.from("office_workflows").select("id, code, name, card_answers").eq("office_id", officeId).order("position"),
    db
      .from("office_scenarios")
      .select("id, workflow, office_workflow_id, schedule_day, version, type, points, test_status")
      .eq("office_id", officeId)
      .eq("is_repeat_variant", false)
      .limit(5000),
    db.from("settings").select("value").eq("key", "sequence").maybeSingle(),
  ]);
  const rows = (must(scenarios) ?? []) as ScenarioRow[];
  const order = ((must(sequence)?.value as string[] | undefined) ?? []).reduce<Record<string, number>>((m, c, i) => ({ ...m, [c]: i }), {});
  const daysOf = (code: string) =>
    [...new Set(rows.filter((s) => s.workflow === code && s.version === "A").map((s) => s.schedule_day))].sort(
      (a, b) => (order[a] ?? 99) - (order[b] ?? 99),
    );
  const list = [
    ...(must(workflows) ?? []).map((w) => ({
      key: w.code as string,
      code: w.code as string,
      name: w.name as string,
      grayId: null as string | null,
      passStandard: (w.pass_standard as string | null) ?? null,
      sopOutline: (w.sop_outline as string[] | null) ?? null,
    })),
    ...(must(gray) ?? []).map((g) => ({
      key: g.code as string,
      code: g.code as string,
      name: (g.name as string | null) || String((g.card_answers as Record<string, unknown>)?.CARD_NAME ?? g.code),
      grayId: g.id as string,
      passStandard: null,
      sopOutline: null,
    })),
  ].map((w) => ({ ...w, days: daysOf(w.code) }));
  return { workflows: list, scenarios: rows };
}

export type OfficeWorkflow = Awaited<ReturnType<typeof officeWorkflows>>["workflows"][number];

const certFor = (certs: CertRow[], w: OfficeWorkflow) =>
  certs.find((c) => (w.grayId ? c.office_workflow_id === w.grayId : c.workflow === w.code)) ?? null;

// ---------------------------------------------------------------------------
// Recalculate
// ---------------------------------------------------------------------------

export async function recalculateCertifications(vaId: string): Promise<void> {
  const db = createAdminClient();
  const profile = must(await db.from("profiles").select("office_id").eq("id", vaId).maybeSingle());
  if (!profile?.office_id) return;
  const officeId = profile.office_id as string;

  const [{ workflows, scenarios }, attemptsRes, certsRes, settings] = await Promise.all([
    officeWorkflows(db, officeId),
    db
      .from("attempts")
      .select("id, kind, schedule_day, version, submitted_at, result, certification_id, created_at")
      .eq("va_id", vaId)
      .eq("office_id", officeId)
      // Archived attempts (reset for testing) are no evidence.
      .is("archived_at", null),
    db.from("certifications").select(CERT_COLUMNS).eq("va_id", vaId).eq("office_id", officeId),
    db.from("settings").select("key, value").eq("key", "certification"),
  ]);
  const attempts = (must(attemptsRes) ?? []) as AttemptRow[];
  let certs = (must(certsRes) ?? []) as CertRow[];
  const certification = (settingValue(must(settings) ?? [], "certification") ?? {}) as Record<string, unknown>;
  const recheckDays = typeof certification.recheck_days_default === "number" ? certification.recheck_days_default : DEFAULT_RECHECK_DAYS;

  const submitted = attempts.filter((a) => a.submitted_at);
  const items = submitted.length
    ? (must(
        await db
          .from("attempt_items")
          .select("attempt_id, office_scenario_id, first_score, repeat_score, repeat_scenario_id, critical_error, ai_confidence, vfda_override")
          .in(
            "attempt_id",
            submitted.map((a) => a.id),
          )
          .limit(10000),
      ) ?? [])
    : [];
  // Drill items can be recheck variants, which aren't in `scenarios`.
  const known = new Map(scenarios.map((s) => [s.id, s]));
  const unknownIds = [...new Set(items.map((i) => i.office_scenario_id).filter((id) => !known.has(id)))];
  if (unknownIds.length) {
    const extra = must(
      await db
        .from("office_scenarios")
        .select("id, workflow, office_workflow_id, schedule_day, version, type, points, test_status")
        .in("id", unknownIds),
    ) as ScenarioRow[];
    for (const s of extra ?? []) known.set(s.id, s);
  }

  const evidenceOf = (attemptIds: string[], code: string): EvidenceItem[] =>
    items
      .filter((i) => attemptIds.includes(i.attempt_id) && known.get(i.office_scenario_id)?.workflow === code)
      .map((i) => {
        const s = known.get(i.office_scenario_id)!;
        const e = withOverride(
          {
            first_score: i.first_score,
            repeat_score: i.repeat_score,
            critical_error: i.critical_error,
            ai_confidence: i.ai_confidence === null ? null : Number(i.ai_confidence),
          },
          i.vfda_override,
        );
        return {
          type: s.type,
          points: s.points,
          first_score: e.first_score,
          repeat_score: e.repeat_score,
          repeated: !!i.repeat_scenario_id,
          critical_error: e.critical_error,
        };
      });

  const dayAttempts = submitted.filter((a) => a.kind === "day");
  const now = new Date();

  for (const w of workflows) {
    if (!w.days.length) continue;
    const lastDay = w.days[w.days.length - 1];
    let cert = certFor(certs, w);
    // Due once the VA has finished the workflow's last scheduled day.
    if (!cert) {
      if (!dayAttempts.some((a) => a.schedule_day === lastDay)) continue;
      const { data, error } = await db
        .from("certifications")
        .insert({ va_id: vaId, office_id: officeId, workflow: w.grayId ? null : w.code, office_workflow_id: w.grayId, status: "pending" })
        .select(CERT_COLUMNS)
        .single();
      if (error) {
        // Created by a request running at the same time.
        const again = must(await db.from("certifications").select(CERT_COLUMNS).eq("va_id", vaId).eq("office_id", officeId)) as CertRow[];
        certs = again;
        cert = certFor(certs, w);
        if (!cert) throw new Error(error.message);
      } else {
        cert = data as CertRow;
        certs = [...certs, cert];
      }
    }

    // Evidence: the latest finished recheck, else the day attempt of each of
    // the workflow's days (the latest one that isn't archived).
    const current = certStatus(cert.status);
    const recheck = latestBy(attempts.filter((a) => a.certification_id === cert!.id && a.kind === "recheck"));
    const dayIds = w.days.map((d) => latestBy(dayAttempts.filter((a) => a.schedule_day === d))?.id);
    const evidence = recheck ? evidenceOf([recheck.id], w.code) : evidenceOf(dayIds.filter((x): x is string => !!x), w.code);
    const { status } = evaluateWorkflow({
      items: evidence,
      allDone: !!recheck || dayIds.every(Boolean),
      passStandard: w.passStandard,
      sopStatus: cert.sop_status,
      sopSubmitted: !!cert.sop_submitted_at,
    });

    const patch: Record<string, unknown> = {
      status,
      attempts: evidence.length,
      errors: evidence.filter((i) => i.critical_error).length,
    };
    if (status === "certified") {
      const certifiedAt = current === "certified" && cert.certified_at ? cert.certified_at : now.toISOString();
      patch.certified_at = certifiedAt;
      // A recheck starts a new period; otherwise it runs from certification.
      patch.recheck_date = recheck?.submitted_at
        ? addDays(recheck.submitted_at, recheckDays)
        : (current === "certified" && cert.recheck_date) || addDays(certifiedAt, recheckDays);
    } else {
      patch.certified_at = null;
      patch.recheck_date = null;
    }
    const changed = Object.entries(patch).some(([k, v]) => (cert as Record<string, unknown>)[k] !== v);
    if (changed) must(await db.from("certifications").update(patch).eq("id", cert.id));
  }
}

async function createDrill(
  db: Db,
  r: { vaId: string; officeId: string; certificationId: string; day: string; scenarioIds: string[] },
) {
  const attempt = must(
    await db
      .from("attempts")
      .insert({
        va_id: r.vaId,
        office_id: r.officeId,
        schedule_day: r.day,
        version: "A",
        kind: "recheck",
        certification_id: r.certificationId,
      })
      .select("id")
      .single(),
  ) as { id: string };
  must(
    await db
      .from("attempt_items")
      .insert(r.scenarioIds.map((id, position) => ({ attempt_id: attempt.id, office_scenario_id: id, position }))),
  );
  return true;
}

// ---------------------------------------------------------------------------
// Rechecks (daily cron)
// ---------------------------------------------------------------------------

const shuffle = <T>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

// Opens a recheck for each certification past its recheck date: 5 situational
// scenarios of the workflow, with new details written by Claude.
export async function openDueRechecks(today: string, limit = 5) {
  const db = createAdminClient();
  const due = (must(
    await db.from("certifications").select(CERT_COLUMNS).eq("status", "certified").lte("recheck_date", today).order("recheck_date").limit(50),
  ) ?? []) as CertRow[];
  const opened: string[] = [];
  const errors: string[] = [];
  for (const cert of due) {
    if (opened.length >= limit) break;
    const { data: open } = await db
      .from("attempts")
      .select("id")
      .eq("certification_id", cert.id)
      .eq("kind", "recheck")
      .is("submitted_at", null)
      .limit(1);
    if (open?.length) continue;
    try {
      if (await openRecheck(db, cert)) opened.push(cert.id);
    } catch (e) {
      errors.push(`${cert.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { due: due.length, opened, errors };
}

async function openRecheck(db: Db, cert: CertRow) {
  // Only while the VA is active and still at the office the certification is for.
  const profile = must(await db.from("profiles").select("office_id, deactivated_at").eq("id", cert.va_id).maybeSingle());
  if (profile?.office_id !== cert.office_id || profile.deactivated_at) return false;
  const officeId = cert.office_id;
  let code = cert.workflow;
  if (!code && cert.office_workflow_id) {
    code = (must(await db.from("office_workflows").select("code").eq("id", cert.office_workflow_id).maybeSingle()) as { code: string } | null)?.code ?? null;
  }
  if (!code) return false;
  let pool =
    must(
      await db
        .from("office_scenarios")
        .select("*")
        .eq("office_id", officeId)
        .eq("workflow", code)
        .eq("version", "A")
        .eq("type", "situational")
        .eq("is_repeat_variant", false)
        .eq("test_status", "live"),
    ) ?? [];
  // Only each day's live version (older versions stay for the VAs who took them).
  const live = new Map(
    ((must(await db.from("office_days").select("schedule_day, live_version").eq("office_id", officeId)) ?? []) as {
      schedule_day: string;
      live_version: number | null;
    }[]).map((d) => [d.schedule_day, d.live_version]),
  );
  pool = pool.filter((p) => p.build_version === live.get(p.schedule_day));
  if (!pool.length) return false;
  const picked = shuffle(pool).slice(0, RECHECK_ITEMS);
  const stems = await writeRecheckVariants(
    picked.map((p, i) => ({ key: `R${i + 1}`, stem: p.stem, correct_response: p.correct_response, critical_fail: p.critical_fail })),
    await officeRulesFor(db, officeId, code),
  );
  const rows = picked.map((p, i) => {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = p;
    void _id;
    void _c;
    void _u;
    return {
      ...rest,
      id: crypto.randomUUID(),
      stem: stems.get(`R${i + 1}`)!,
      options: null,
      answer: null,
      is_repeat_variant: true,
      parent_scenario_id: p.id,
      recheck: true,
      test_status: "live",
      edited_by_vfda: false,
    };
  });
  must(await db.from("office_scenarios").insert(rows));
  const lastDay = picked.map((p) => p.schedule_day as string).sort().at(-1)!;
  return createDrill(db, {
    vaId: cert.va_id,
    officeId,
    certificationId: cert.id,
    day: lastDay,
    scenarioIds: rows.map((r) => r.id),
  });
}

// ---------------------------------------------------------------------------
// The SOP on Trello
// ---------------------------------------------------------------------------

// The VA's "Card updated": saves the link(s) and waits for VFDA to confirm.
// Returns an error to show, or null.
export async function submitSopLinks(vaId: string, certificationId: string, raw: string): Promise<string | null> {
  const { links, error } = parseTrelloLinks(raw);
  if (error) return error;
  const db = createAdminClient();
  const cert = must(await db.from("certifications").select(CERT_COLUMNS).eq("id", certificationId).eq("va_id", vaId).maybeSingle()) as CertRow | null;
  if (!cert) return "This workflow isn't yours.";
  if (cert.sop_status === "approved" && cert.status === "certified") return "This card is already approved.";
  const { error: saveError } = await db
    .from("certifications")
    .update({ sop_links: links, sop_link: links[0], sop_submitted_at: new Date().toISOString(), sop_status: "pending" })
    .eq("id", cert.id);
  if (saveError) return "Couldn't save. Try again.";
  await recalculateCertifications(vaId);
  return null;
}

// ---------------------------------------------------------------------------
// What the VA has to do besides the training day (Today page)
// ---------------------------------------------------------------------------

export async function loadVaTasks(vaId: string, officeId: string) {
  const db = createAdminClient();
  const [{ workflows }, certsRes, drillsRes] = await Promise.all([
    officeWorkflows(db, officeId),
    db.from("certifications").select(CERT_COLUMNS).eq("va_id", vaId).eq("office_id", officeId),
    db.from("attempts").select("id, kind, certification_id").eq("va_id", vaId).eq("office_id", officeId).eq("kind", "recheck").is("submitted_at", null).order("created_at"),
  ]);
  const certs = (must(certsRes) ?? []) as CertRow[];
  const workflowOf = (c: CertRow) => workflows.find((w) => (c.office_workflow_id ? w.grayId === c.office_workflow_id : w.code === c.workflow));
  const sop = certs
    .filter((c) => c.sop_status !== "approved")
    .map((c) => {
      const w = workflowOf(c);
      return {
        certificationId: c.id,
        code: w?.code ?? c.workflow ?? "",
        name: w?.name ?? c.workflow ?? "",
        outline: w?.sopOutline?.length ? w.sopOutline : DEFAULT_SOP_OUTLINE,
        links: c.sop_links ?? [],
        sopStatus: c.sop_status,
        note: c.sop_note,
        submittedAt: c.sop_submitted_at,
        // Something for the VA to do: never sent, or sent back.
        todo: !c.sop_submitted_at || c.sop_status === "needs_changes" || c.sop_status === "rejected",
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const drills = ((must(drillsRes) ?? []) as { id: string; kind: "recheck"; certification_id: string }[]).map((d) => {
    const c = certs.find((x) => x.id === d.certification_id);
    const w = c ? workflowOf(c) : undefined;
    return { id: d.id, kind: d.kind, code: w?.code ?? "", name: w?.name ?? "" };
  });
  return { sop, drills };
}

// ---------------------------------------------------------------------------
// Certification grid (admin, doctor, VA): every VA × the office's workflows
// ---------------------------------------------------------------------------

export type GridCell = {
  code: string;
  name: string;
  applies: boolean;
  certificationId: string | null;
  status: CertStatus | null; // null: the last scheduled day isn't reached yet
  sopStatus: SopStatus | null;
  sopNote: string | null;
  links: string[];
  submittedAt: string | null;
  certifiedAt: string | null;
  recheckDate: string | null;
  openDrill: "recheck" | null;
  // Certification uses first-try scores; a retake on the workflow's days shows here as a note.
  retakeNote: string | null;
};

export type GridRow = {
  vaId: string;
  vaName: string;
  email: string;
  officeId: string | null;
  officeName: string;
  cells: GridCell[];
  allCertified: boolean;
};

// `db` decides what's visible: the admin's or doctor's session (row-level
// security), or the service role for a VA's own row.
export async function loadCertGrid(db: Db, filter: { vaIds?: string[]; officeId?: string }) {
  let vaQuery = db.from("profiles").select("id, full_name, email, office_id").eq("role", "va").is("deactivated_at", null).order("full_name");
  if (filter.vaIds) vaQuery = vaQuery.in("id", filter.vaIds.length ? filter.vaIds : ["00000000-0000-0000-0000-000000000000"]);
  if (filter.officeId) vaQuery = vaQuery.eq("office_id", filter.officeId);
  const [vas, offices, standard] = await Promise.all([
    vaQuery,
    db.from("offices").select("id, name"),
    db.from("workflows").select("code, name").order("code"),
  ]);
  const vaRows = (must(vas) ?? []) as { id: string; full_name: string | null; email: string; office_id: string | null }[];
  const vaIds = vaRows.map((v) => v.id);
  const officeIds = [...new Set(vaRows.map((v) => v.office_id).filter((x): x is string => !!x))];
  const [perOffice, certsRes, drillsRes, retakesRes] = await Promise.all([
    Promise.all(officeIds.map(async (id) => [id, (await officeWorkflows(db, id)).workflows] as const)),
    vaIds.length ? db.from("certifications").select(CERT_COLUMNS).in("va_id", vaIds) : Promise.resolve({ data: [], error: null }),
    vaIds.length
      ? db.from("attempts").select("va_id, kind, certification_id").in("va_id", vaIds).eq("kind", "recheck").is("submitted_at", null)
      : Promise.resolve({ data: [], error: null }),
    // Finished day attempts and retakes, for the retake notes.
    vaIds.length
      ? db
          .from("attempts")
          .select("id, va_id, office_id, kind, schedule_day, parent_attempt_id, first_try_points, max_points")
          .in("va_id", vaIds)
          .in("kind", ["day", "retake"])
          .not("submitted_at", "is", null)
          .is("archived_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  type Scored = { id: string; va_id: string; office_id: string; kind: string; schedule_day: string; parent_attempt_id: string | null; first_try_points: number | null; max_points: number | null };
  const scored = (must(retakesRes) ?? []) as Scored[];
  const retakeNote = (vaId: string, officeId: string | null, days: string[]) => {
    const notes = scored
      .filter((a) => a.kind === "retake" && a.va_id === vaId && a.office_id === officeId && days.includes(a.schedule_day))
      .flatMap((r) => {
        const first = scored.find((a) => a.id === r.parent_attempt_id);
        return first
          ? [`${r.schedule_day} ${percentOf(first.first_try_points, first.max_points)}% → ${percentOf(r.first_try_points, r.max_points)}%`]
          : [];
      });
    return notes.length ? `Retake: ${notes.join(", ")} (first try counts)` : null;
  };
  const workflowsOf = new Map(perOffice);
  const certs = (must(certsRes) ?? []) as CertRow[];
  const drills = (must(drillsRes) ?? []) as { va_id: string; kind: "recheck"; certification_id: string }[];
  const officeName = new Map(((must(offices) ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const columns = ((must(standard) ?? []) as { code: string; name: string }[]).map((w) => ({ code: w.code, name: w.name }));

  const rows: GridRow[] = vaRows.map((va) => {
    const list = va.office_id ? (workflowsOf.get(va.office_id) ?? []) : [];
    const cell = (w: { code: string; name: string }, ow: OfficeWorkflow | undefined): GridCell => {
      const c = ow ? certs.find((x) => x.va_id === va.id && x.office_id === va.office_id && (ow.grayId ? x.office_workflow_id === ow.grayId : x.workflow === ow.code)) : undefined;
      return {
        code: w.code,
        name: w.name,
        applies: !!ow?.days.length,
        certificationId: c?.id ?? null,
        status: c ? certStatus(c.status) : null,
        sopStatus: c?.sop_status ?? null,
        sopNote: c?.sop_note ?? null,
        links: c?.sop_links?.length ? c.sop_links : c?.sop_link ? [c.sop_link] : [],
        submittedAt: c?.sop_submitted_at ?? null,
        certifiedAt: c?.certified_at ?? null,
        recheckDate: c?.recheck_date ?? null,
        openDrill: c ? (drills.find((d) => d.certification_id === c.id)?.kind ?? null) : null,
        retakeNote: ow ? retakeNote(va.id, va.office_id, ow.days) : null,
      };
    };
    const cells = [
      ...columns.map((w) => cell(w, list.find((x) => !x.grayId && x.code === w.code))),
      ...list.filter((x) => x.grayId).map((g) => cell({ code: g.code, name: g.name }, g)),
    ];
    const applicable = cells.filter((x) => x.applies);
    return {
      vaId: va.id,
      vaName: va.full_name || va.email,
      email: va.email,
      officeId: va.office_id,
      officeName: va.office_id ? (officeName.get(va.office_id) ?? "Unknown office") : "No office",
      cells,
      allCertified: applicable.length > 0 && applicable.every((x) => x.status === "certified"),
    };
  });
  return { columns, rows };
}

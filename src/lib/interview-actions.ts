"use server";

// Saves from the office setup screen. Every action re-checks who's calling and
// writes as that user, so row-level security (and the database guards on
// office_rules and office_workflows) apply on top of these checks.

import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import {
  checkAnswerValue,
  checkAttachments,
  RISK_TAGS,
  UPLOAD_BUCKET,
  type Attachment,
  type GrayCard,
  type InterviewQuestion,
  type RiskTag,
} from "@/lib/interview";
import { createSessionClient } from "@/lib/supabase/server";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;

// Admins may edit any office; doctors only their own.
async function authorize(officeId: string) {
  if (!UUID.test(officeId)) return null;
  const user = await getCurrentUser();
  if (user?.role === "vfda_admin") return user;
  if (user?.role === "doctor" && user.officeId === officeId) return user;
  return null;
}

async function getQuestion(supabase: Awaited<ReturnType<typeof createSessionClient>>, key: string) {
  const { data } = await supabase
    .from("rule_slots")
    .select("key, schedule_day, question, answer_type, condition, card_source")
    .eq("key", key)
    .maybeSingle();
  if (!data) return null;
  return {
    key: data.key,
    quiz: data.schedule_day,
    question: data.question,
    answer_type: data.answer_type,
    condition: data.condition,
    source: data.card_source,
  } as InterviewQuestion;
}

// The office's direct rule for one slot: one row per office + key with no
// source document. A doctor's answer is accepted with their approval; VFDA's
// is accepted as reviewed by VFDA.
function directRule(officeId: string, key: string, user: CurrentUser) {
  const now = new Date().toISOString();
  return {
    office_id: officeId,
    rule_slot_key: key,
    source_document_id: null,
    status: "accepted",
    ...(user.role === "doctor"
      ? { source: "doctor", doctor_approved_by: user.id, doctor_approved_at: now }
      : { source: "vfda", vfda_reviewed_by: user.id, vfda_reviewed_at: now }),
  };
}
const DIRECT_RULE_KEY = "office_id,rule_slot_key,source_document_id";

export async function saveInterviewAnswer(
  officeId: string,
  key: string,
  value: unknown,
): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't edit this office's setup.");
  const supabase = await createSessionClient();
  const question = await getQuestion(supabase, key);
  if (!question) return fail("Unknown question.");
  const problem = checkAnswerValue(question, value);
  if (problem) return fail(problem);

  const { error } = await supabase
    .from("office_rules")
    .upsert({ ...directRule(officeId, key, user), rule: value }, { onConflict: DIRECT_RULE_KEY });
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

async function readAttachments(supabase: Awaited<ReturnType<typeof createSessionClient>>, officeId: string, key: string) {
  const { data: row } = await supabase
    .from("office_rules")
    .select("attachments")
    .eq("office_id", officeId)
    .eq("rule_slot_key", key)
    .is("source_document_id", null)
    .maybeSingle();
  return (row?.attachments ?? []) as Attachment[];
}

// Records one uploaded file on its question. Appends on the server, so several
// uploads at once can't overwrite each other.
export async function addInterviewFile(
  officeId: string,
  key: string,
  file: Attachment,
): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't edit this office's setup.");
  const supabase = await createSessionClient();
  const question = await getQuestion(supabase, key);
  if (question?.answer_type !== "upload") return fail("This question doesn't take files.");

  const current = await readAttachments(supabase, officeId, key);
  const attachments = [...current.filter((a) => a.path !== file?.path), file];
  const problem = checkAttachments(officeId, attachments);
  if (problem) return fail(problem);

  const { error } = await supabase
    .from("office_rules")
    .upsert({ ...directRule(officeId, key, user), attachments }, { onConflict: DIRECT_RULE_KEY });
  return error ? fail("Couldn't save the file. Try again.") : { ok: true, data: null };
}

export async function deleteInterviewFile(
  officeId: string,
  key: string,
  path: string,
): Promise<ActionResult<Attachment[]>> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't edit this office's setup.");
  if (!path.startsWith(`${officeId}/`) || path.includes("..")) return fail("Invalid file.");
  const supabase = await createSessionClient();

  const remaining = (await readAttachments(supabase, officeId, key)).filter((a) => a.path !== path);

  const { error: storageError } = await supabase.storage.from(UPLOAD_BUCKET).remove([path]);
  if (storageError) return fail("Couldn't delete the file. Try again.");
  const { error } = await supabase
    .from("office_rules")
    .upsert({ ...directRule(officeId, key, user), attachments: remaining }, { onConflict: DIRECT_RULE_KEY });
  return error ? fail("Couldn't update the file list.") : { ok: true, data: remaining };
}

// ---------------------------------------------------------------------------
// Gray cards (stored as the office's gray card workflows, WF-G1, WF-G2, ...)
// ---------------------------------------------------------------------------

const CARD_KEY = /^CARD_[A-Z_]{1,40}$/;
const CARD_COLUMNS = "id, code, card_answers, risk_tag, position";

export async function addGrayCard(officeId: string, name = ""): Promise<ActionResult<GrayCard>> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't edit this office's gray cards.");
  const supabase = await createSessionClient();
  const { data: last } = await supabase
    .from("office_workflows")
    .select("position")
    .eq("office_id", officeId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  // code '' = the database picks the next free WF-G number.
  const { data, error } = await supabase
    .from("office_workflows")
    .insert({
      office_id: officeId,
      code: "",
      card_answers: name.trim() ? { CARD_NAME: name.trim().slice(0, 200) } : {},
      position: (last?.position ?? -1) + 1,
    })
    .select(CARD_COLUMNS)
    .single();
  if (error) return fail("Couldn't add the card.");
  return {
    ok: true,
    data: { id: data.id, code: data.code, answers: data.card_answers, risk_tag: data.risk_tag, position: data.position },
  };
}

export async function saveGrayCard(
  officeId: string,
  cardId: string,
  answers: Record<string, string>,
): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't edit this office's gray cards.");
  const entries = Object.entries(answers ?? {});
  if (
    !UUID.test(cardId) ||
    entries.length > 30 ||
    !entries.every(([k, v]) => CARD_KEY.test(k) && typeof v === "string" && v.length <= 10_000)
  ) {
    return fail("Invalid card.");
  }
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("office_workflows")
    .update({ card_answers: answers })
    .eq("id", cardId)
    .eq("office_id", officeId)
    .select("id");
  if (error || !data?.length) return fail("Couldn't save the card. Try again.");
  return { ok: true, data: null };
}

export async function deleteGrayCard(officeId: string, cardId: string): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (!user || !UUID.test(cardId)) return fail("You can't edit this office's gray cards.");
  const supabase = await createSessionClient();
  const { error } = await supabase.from("office_workflows").delete().eq("id", cardId).eq("office_id", officeId);
  return error ? fail("Couldn't remove the card.") : { ok: true, data: null };
}

export async function setGrayCardRisk(
  officeId: string,
  cardId: string,
  risk: RiskTag | null,
): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (user?.role !== "vfda_admin") return fail("Only VFDA sets risk tags.");
  if (!UUID.test(cardId) || (risk !== null && !RISK_TAGS.includes(risk))) return fail("Invalid risk tag.");
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("office_workflows")
    .update({ risk_tag: risk })
    .eq("id", cardId)
    .eq("office_id", officeId)
    .select("id");
  return error || !data?.length ? fail("Couldn't save the risk tag.") : { ok: true, data: null };
}

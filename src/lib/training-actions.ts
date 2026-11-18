"use server";

// The training program's buttons: VFDA's "Generate training program now"
// (testing), "Send this week now (test email)" and sheet edits before a
// session is sent; the doctor's (and VFDA's) "Mark session done".

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProgram } from "@/lib/training-program";
import { scenarioOrder, type Sheet } from "@/lib/training-plan";
import { sendProgramTest } from "@/lib/training-send";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail = (error: string) => ({ ok: false, error }) as const;

async function admin() {
  const user = await getCurrentUser();
  return user?.role === "vfda_admin" ? user : null;
}

async function vaOffice(vaId: string) {
  const { data } = await createAdminClient().from("profiles").select("office_id, role, full_name, email").eq("id", vaId).maybeSingle();
  return data?.role === "va" && data.office_id ? { officeId: data.office_id as string, name: (data.full_name || data.email || "VA") as string } : null;
}

const refresh = (vaId: string) => {
  revalidatePath(`/admin/training/${vaId}`);
  revalidatePath(`/doctor/training/${vaId}`);
  revalidatePath("/admin/training");
};

// For testing: builds (or rebuilds) the program now, even with days missing.
export async function generateProgramNow(vaId: string): Promise<ActionResult<string>> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(vaId)) return fail("Invalid request.");
  const va = await vaOffice(vaId);
  if (!va) return fail("VA not found.");
  try {
    const r = await buildProgram(createAdminClient(), vaId, va.officeId, { test: true, by: user.id });
    refresh(vaId);
    const warn = r.missing.length
      ? ` Warning: ${r.missing.length} scheduled day${r.missing.length === 1 ? " isn't" : "s aren't"} submitted yet (${r.missing.join(", ")}), so the plan leaves ${r.missing.length === 1 ? "it" : "them"} out.`
      : "";
    return {
      ok: true,
      data: `Training program built for ${va.name} (test). Nothing was sent, doctors don't see it, and the Sunday cron never sends a test build: use "Send this week now (test email)". The real program replaces it once every scheduled day is submitted.${warn}`,
    };
  } catch (e) {
    return fail(`Not built: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function sendThisWeekTest(vaId: string, to: string): Promise<ActionResult<string>> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  const address = String(to ?? "").trim();
  if (!UUID.test(vaId)) return fail("Invalid request.");
  if (!EMAIL.test(address)) return fail("Enter an email address.");
  const va = await vaOffice(vaId);
  if (!va) return fail("VA not found.");
  const r = await sendProgramTest(createAdminClient(), vaId, va.officeId, address);
  if (r.error) return fail(r.error);
  return { ok: true, data: `Week ${r.week} sent to ${address}: ${r.subjects.join(" | ")}` };
}

// The doctor of the session's office, or VFDA.
export async function markSessionDone(sessionId: string, note: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user?.role !== "doctor" && user?.role !== "vfda_admin") return fail("Not allowed.");
  if (!UUID.test(sessionId)) return fail("Invalid request.");
  const db = createAdminClient();
  const { data: s } = await db.from("training_sessions").select("office_id, va_id, program_id").eq("id", sessionId).maybeSingle();
  if (!s || (user.role === "doctor" && s.office_id !== user.officeId)) return fail("Not allowed.");
  const { error } = await db
    .from("training_sessions")
    .update({ status: "done", done_at: new Date().toISOString(), done_by: user.id, done_note: String(note ?? "").trim().slice(0, 1000) || null })
    .eq("id", sessionId);
  if (error) return fail("Couldn't save. Try again.");
  refresh(s.va_id);
  return { ok: true, data: null };
}

const lines = (s: string, max: number, len = 300) =>
  String(s ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);

export type SheetForm = {
  title: string;
  buildOn: string;
  summary: string;
  explain: string;
  emailLine: string;
  wrapUp: string;
  scenarios: { ask: string; listenFor: string; followUp: string; card: string }[];
};

// VFDA edits a sheet before it's sent.
export async function saveSheet(sessionId: string, form: SheetForm): Promise<ActionResult> {
  const user = await admin();
  if (!user) return fail("VFDA admins only.");
  if (!UUID.test(sessionId)) return fail("Invalid request.");
  const db = createAdminClient();
  const { data: s } = await db.from("training_sessions").select("va_id, number, sent_at").eq("id", sessionId).maybeSingle();
  if (!s) return fail("Session not found.");
  if (s.sent_at) return fail("This sheet was already sent; it can't be changed.");
  const order = scenarioOrder(s.number);
  const sheet: Sheet = {
    title: form.title.trim().slice(0, 80),
    buildOn: form.buildOn.trim().slice(0, 120),
    summary: form.summary.trim().slice(0, 800),
    explain: lines(form.explain, 3),
    emailLine: form.emailLine.trim().slice(0, 400),
    wrapUp: lines(form.wrapUp, 2),
    scenarios: order.map((kind, n) => ({
      kind,
      ask: String(form.scenarios[n]?.ask ?? "").trim().slice(0, 500),
      listenFor: lines(form.scenarios[n]?.listenFor ?? "", 4, 200),
      followUp: String(form.scenarios[n]?.followUp ?? "").trim().slice(0, 250),
      card: String(form.scenarios[n]?.card ?? "").trim().slice(0, 100),
    })),
  };
  if (!sheet.title || !sheet.summary) return fail("Write a title and what you'll go through.");
  if (sheet.scenarios.some((x) => !x.ask || !x.listenFor.length)) return fail("Every scenario needs what to ask and at least one 'Listen for' line.");
  if (sheet.wrapUp.length !== 2) return fail("Write exactly 2 wrap-up questions, one per line.");
  const { error } = await db.from("training_sessions").update({ sheet, edited_at: new Date().toISOString(), edited_by: user.id }).eq("id", sessionId).is("sent_at", null);
  if (error) return fail("Couldn't save. Try again.");
  refresh(s.va_id);
  return { ok: true, data: null };
}

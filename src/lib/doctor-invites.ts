import "server-only";

// Doctors of an office (/admin/offices/[id]): invite (more than one), a
// sign-in link by email (Resend), make one the Primary doctor, remove one.
// Every doctor gets their own login tied to the same office. Service role:
// creating logins and assigning roles bypasses row-level security.

import { escapeHtml } from "@/lib/report";
import { appUrl, sendEmail, tryTwice } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { signInLink } from "@/lib/va-invites";

type Db = ReturnType<typeof createAdminClient>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type OfficeDoctor = { id: string; name: string; email: string; primary: boolean; lastSignIn: string | null };

export const doctorName = (p: { full_name: string | null; email: string }) => p.full_name?.trim() || p.email;

// The office's doctors, the Primary first.
export async function loadOfficeDoctors(officeId: string): Promise<OfficeDoctor[]> {
  const db = createAdminClient();
  const [{ data: office }, { data, error }] = await Promise.all([
    db.from("offices").select("primary_doctor_id").eq("id", officeId).maybeSingle(),
    db.from("profiles").select("id, full_name, email, created_at").eq("role", "doctor").eq("office_id", officeId).order("created_at"),
  ]);
  if (error) throw new Error(error.message);
  const doctors = (data ?? []) as { id: string; full_name: string | null; email: string }[];
  const logins = await Promise.all(doctors.map((d) => db.auth.admin.getUserById(d.id)));
  return doctors
    .map((d, i) => ({
      id: d.id,
      name: doctorName(d),
      email: d.email,
      primary: d.id === office?.primary_doctor_id,
      lastSignIn: logins[i].data.user?.last_sign_in_at ?? null,
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

// Creates the login (or reuses one with no role yet) and the doctor profile
// for this office, then emails the sign-in link. The office's first doctor
// becomes Primary.
export async function inviteDoctor(input: { officeId: string; name: string; email: string; origin: string | null }): Promise<{ ok: boolean; message: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || name.length > 200) return { ok: false, message: "Enter the doctor's name." };
  if (!EMAIL.test(email) || email.length > 320) return { ok: false, message: "Enter a valid email address." };

  const db = createAdminClient();
  const { data: office } = await db.from("offices").select("id, name, primary_doctor_id").eq("id", input.officeId).maybeSingle();
  if (!office) return { ok: false, message: "Office not found." };

  const { data: existing } = await db
    .from("profiles")
    .select("id, role, office_id")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();
  if (existing?.role) {
    const where = existing.office_id === office.id ? " at this office" : "";
    return { ok: false, message: `${email} already has access as ${existing.role}${where}.` };
  }

  const link = await signInLink(db, email, existing ? "magiclink" : "invite", name, input.origin);
  if ("error" in link) return { ok: false, message: `Couldn't create the login: ${link.error}` };

  // The new-user trigger creates the profile; upsert covers any gap.
  const { error: profileError } = await db
    .from("profiles")
    .upsert({ id: link.userId, email, full_name: name, role: "doctor", office_id: office.id, deactivated_at: null }, { onConflict: "id" });
  if (profileError) return { ok: false, message: "The login was created, but giving doctor access failed. Try again." };
  if (!office.primary_doctor_id) await db.from("offices").update({ primary_doctor_id: link.userId }).eq("id", office.id);

  const sendError = await emailLink(email, name, office.name, link.url, link.userId);
  return sendError
    ? { ok: true, message: `${name} added, but the email didn't go out (${sendError}). Use "Send sign-in link" once email works.` }
    : { ok: true, message: `${name} added. Sign-in link sent to ${email}.` };
}

const doctorOf = async (db: Db, officeId: string, doctorId: string) =>
  (await db.from("profiles").select("id, email, full_name").eq("id", doctorId).eq("role", "doctor").eq("office_id", officeId).maybeSingle()).data as {
    id: string;
    email: string;
    full_name: string | null;
  } | null;

export async function resendDoctorLink(officeId: string, doctorId: string, origin: string | null): Promise<string | null> {
  const db = createAdminClient();
  const doctor = await doctorOf(db, officeId, doctorId);
  if (!doctor) return "Doctor not found.";
  const { data: office } = await db.from("offices").select("name").eq("id", officeId).maybeSingle();
  const link = await signInLink(db, doctor.email, "magiclink", doctorName(doctor), origin);
  if ("error" in link) return `Couldn't create the link: ${link.error}`;
  const sendError = await emailLink(doctor.email, doctorName(doctor), office?.name ?? "", link.url, doctor.id);
  return sendError ? `The email didn't go out: ${sendError}` : null;
}

// The Primary doctor is shown on the office, certificates and reports.
export async function setPrimaryDoctor(officeId: string, doctorId: string): Promise<string | null> {
  const db = createAdminClient();
  if (!(await doctorOf(db, officeId, doctorId))) return "Doctor not found.";
  const { error } = await db.from("offices").update({ primary_doctor_id: doctorId }).eq("id", officeId);
  return error ? "Couldn't save. Try again." : null;
}

// Removes the doctor from the office: their login stays but has no access (no
// role; row-level security needs it). The profile keeps the office, so what
// they did still shows under their name. The last
// doctor can't be removed; a removed Primary hands over to the longest-standing
// other doctor.
export async function removeDoctor(officeId: string, doctorId: string): Promise<string | null> {
  const db = createAdminClient();
  if (!(await doctorOf(db, officeId, doctorId))) return "Doctor not found.";
  const [{ data: office }, { data: others }] = await Promise.all([
    db.from("offices").select("primary_doctor_id").eq("id", officeId).maybeSingle(),
    db.from("profiles").select("id").eq("role", "doctor").eq("office_id", officeId).neq("id", doctorId).order("created_at"),
  ]);
  if (!others?.length) return "This is the office's only doctor. Invite another doctor first.";
  if (office?.primary_doctor_id === doctorId) {
    const { error } = await db.from("offices").update({ primary_doctor_id: others[0].id }).eq("id", officeId);
    if (error) return "Couldn't hand Primary to another doctor. Try again.";
  }
  const { error } = await db.from("profiles").update({ role: null }).eq("id", doctorId).eq("role", "doctor");
  return error ? "Couldn't remove the doctor. Try again." : null;
}

async function emailLink(to: string, name: string, office: string, url: string, userId: string) {
  const login = `${appUrl()}/login`;
  const subject = `Your VFDA login${office ? ` – ${office}` : ""}`;
  const text = [
    `Hi ${name},`,
    "",
    `VFDA has given you doctor access${office ? ` for ${office}` : ""}: your office's setup, your VAs' training and their results.`,
    "",
    `Sign in: ${url}`,
    "",
    `The link works once and expires soon. If it has expired, go to ${login} and enter this email address to get a new one.`,
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>VFDA has given you doctor access${office ? ` for <strong>${escapeHtml(office)}</strong>` : ""}: your office's setup, your VAs' training and their results.</p>
<p><a href="${escapeHtml(url)}">Sign in</a></p>
<p style="color:#666">The link works once and expires soon. If it has expired, go to <a href="${escapeHtml(login)}">${escapeHtml(login)}</a> and enter this email address to get a new one.</p>`;
  const key = `doctor-invite:${userId}:${Date.now()}`;
  return tryTwice(() => sendEmail(to, subject, html, text, key));
}

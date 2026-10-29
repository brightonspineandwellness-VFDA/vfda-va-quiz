"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export type AddOfficeState = { ok: boolean; message: string } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Creates the office and invites its doctor. Uses the service role (server
// only) because creating logins and assigning roles bypasses row-level security.
export async function addOffice(_prev: AddOfficeState, form: FormData): Promise<AddOfficeState> {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return { ok: false, message: "Only VFDA admins can add offices." };

  const officeName = String(form.get("officeName") ?? "").trim();
  const doctorName = String(form.get("doctorName") ?? "").trim();
  const email = String(form.get("doctorEmail") ?? "").trim().toLowerCase();
  if (!officeName || officeName.length > 200) return { ok: false, message: "Enter the office name." };
  if (!doctorName || doctorName.length > 200) return { ok: false, message: "Enter the doctor's name." };
  if (!EMAIL.test(email) || email.length > 320) return { ok: false, message: "Enter a valid email address." };

  const admin = createAdminClient();

  // Someone with this email may already have signed in.
  const { data: existing } = await admin
    .from("profiles")
    .select("id, role")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();
  if (existing?.role) {
    return { ok: false, message: `${email} already has access as ${existing.role}. Use a different email.` };
  }

  // The database adds the office's VFDA standards (default tier) and automatic
  // rules (CLINIC_NAME, DOCTOR_NAME, ...) as soon as the office exists.
  const { data: office, error: officeError } = await admin
    .from("offices")
    .insert({ name: officeName, doctor_name: doctorName })
    .select("id")
    .single();
  if (officeError) return { ok: false, message: "Couldn't create the office." };
  const undoOffice = () => admin.from("offices").delete().eq("id", office.id);

  let userId = existing?.id as string | undefined;
  let message: string;

  if (userId) {
    message = `${officeName} added. ${email} already had an account, so no invite was sent: they now have doctor access and can sign in at /login.`;
  } else {
    const origin = (await headers()).get("origin");
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: origin ? `${origin}/auth/callback` : undefined,
      data: { full_name: doctorName },
    });
    if (inviteError || !invited.user) {
      await undoOffice();
      const reason =
        inviteError?.code === "over_email_send_rate_limit"
          ? "Supabase's email limit was reached. Wait an hour or set up custom SMTP."
          : (inviteError?.message ?? "unknown error");
      return { ok: false, message: `Couldn't send the invite: ${reason}` };
    }
    userId = invited.user.id;
    message = `${officeName} added. Invite sent to ${email}.`;
  }

  // The new-user trigger creates the profile; upsert covers any gap.
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, email, full_name: doctorName, role: "doctor", office_id: office.id }, { onConflict: "id" });
  if (profileError) {
    await undoOffice();
    return { ok: false, message: "Invite sent, but giving doctor access failed. Try adding the office again." };
  }

  refresh();
  return { ok: true, message };
}

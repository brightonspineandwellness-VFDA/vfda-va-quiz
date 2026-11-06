"use server";

// "Invite doctor" and the doctor controls on the office page. VFDA admins only.

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { inviteDoctor, removeDoctor, resendDoctorLink, setPrimaryDoctor } from "@/lib/doctor-invites";
import type { ActionResult } from "@/lib/interview-actions";

export type InviteDoctorState = { ok: boolean; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;
const done = (error: string | null): ActionResult => (error ? fail(error) : { ok: true, data: null });

async function isAdmin() {
  return (await getCurrentUser())?.role === "vfda_admin";
}

export async function inviteDoctorAction(officeId: string, _prev: InviteDoctorState, form: FormData): Promise<InviteDoctorState> {
  if (!(await isAdmin())) return { ok: false, message: "Only VFDA admins can invite doctors." };
  if (!UUID.test(officeId)) return { ok: false, message: "Office not found." };
  const result = await inviteDoctor({
    officeId,
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    origin: (await headers()).get("origin"),
  });
  if (result.ok) refresh();
  return result;
}

export async function resendDoctorLinkAction(officeId: string, doctorId: string): Promise<ActionResult> {
  if (!(await isAdmin())) return fail("VFDA admins only.");
  if (!UUID.test(officeId) || !UUID.test(doctorId)) return fail("Invalid request.");
  return done(await resendDoctorLink(officeId, doctorId, (await headers()).get("origin")));
}

export async function setPrimaryDoctorAction(officeId: string, doctorId: string): Promise<ActionResult> {
  if (!(await isAdmin())) return fail("VFDA admins only.");
  if (!UUID.test(officeId) || !UUID.test(doctorId)) return fail("Invalid request.");
  return done(await setPrimaryDoctor(officeId, doctorId));
}

export async function removeDoctorAction(officeId: string, doctorId: string): Promise<ActionResult> {
  if (!(await isAdmin())) return fail("VFDA admins only.");
  if (!UUID.test(officeId) || !UUID.test(doctorId)) return fail("Invalid request.");
  return done(await removeDoctor(officeId, doctorId));
}

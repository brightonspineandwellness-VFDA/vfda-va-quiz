"use server";

// "Invite VA" and the VA controls on the office page. VFDA admins only.

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { inviteVa, moveVa, resendVaLink, setVaActive } from "@/lib/va-invites";

export type InviteVaState = { ok: boolean; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string) => ({ ok: false, error }) as const;
const done = (error: string | null): ActionResult => (error ? fail(error) : { ok: true, data: null });

async function isAdmin() {
  return (await getCurrentUser())?.role === "vfda_admin";
}

export async function inviteVaAction(officeId: string, _prev: InviteVaState, form: FormData): Promise<InviteVaState> {
  if (!(await isAdmin())) return { ok: false, message: "Only VFDA admins can invite VAs." };
  if (!UUID.test(officeId)) return { ok: false, message: "Office not found." };
  const result = await inviteVa({
    officeId,
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    startDate: String(form.get("startDate") ?? ""),
    origin: (await headers()).get("origin"),
  });
  if (result.ok) refresh();
  return result;
}

export async function resendVaLinkAction(vaId: string): Promise<ActionResult> {
  if (!(await isAdmin())) return fail("VFDA admins only.");
  if (!UUID.test(vaId)) return fail("Invalid request.");
  return done(await resendVaLink(vaId, (await headers()).get("origin")));
}

export async function moveVaAction(vaId: string, officeId: string, startDate: string): Promise<ActionResult> {
  if (!(await isAdmin())) return fail("VFDA admins only.");
  if (!UUID.test(vaId) || !UUID.test(officeId)) return fail("Pick the office.");
  return done(await moveVa(vaId, officeId, startDate));
}

export async function setVaActiveAction(vaId: string, active: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return fail("VFDA admins only.");
  if (!UUID.test(vaId)) return fail("Invalid request.");
  return done(await setVaActive(vaId, active));
}

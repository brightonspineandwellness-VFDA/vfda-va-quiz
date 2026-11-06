import "server-only";

// VAs of an office (/admin/offices/[id]): invite, sign-in link by email
// (Resend), start date, move to another office, deactivate. Service role:
// creating logins and assigning roles bypasses row-level security.

import { loadCertGrid, recalculateCertifications } from "@/lib/certifications";
import { escapeHtml } from "@/lib/report";
import { appUrl, sendEmail, tryTwice } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { showDate } from "@/lib/va-flow";
import { normalizeScope, SCOPE_KEYS, type ScopeKey } from "@/lib/va-scope";

type Db = ReturnType<typeof createAdminClient>;

export type VaStatus = "invited" | "training" | "certified" | "deactivated";

export const VA_STATUS_LABELS: Record<VaStatus, string> = {
  invited: "Invited",
  training: "Training",
  certified: "Certified",
  deactivated: "Deactivated",
};

export type OfficeVa = {
  id: string;
  name: string;
  email: string;
  startDate: string | null;
  status: VaStatus;
  lastSignIn: string | null;
  scope: ScopeKey[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Ban length for a deactivated login (Supabase takes hours); about 100 years.
const BANNED = "876000h";

export const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d));

// The office's VAs, deactivated ones last, each with their status.
export async function loadOfficeVas(officeId: string): Promise<OfficeVa[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, email, va_start_date, deactivated_at, va_scope")
    .eq("role", "va")
    .eq("office_id", officeId)
    .order("full_name");
  if (error) throw new Error(error.message);
  const vas = data ?? [];
  if (!vas.length) return [];
  const [grid, logins] = await Promise.all([
    loadCertGrid(db, { officeId }),
    Promise.all(vas.map((v) => db.auth.admin.getUserById(v.id))),
  ]);
  return vas
    .map((v, i) => {
      const lastSignIn = logins[i].data.user?.last_sign_in_at ?? null;
      const status: VaStatus = v.deactivated_at
        ? "deactivated"
        : !lastSignIn
          ? "invited"
          : grid.rows.find((r) => r.vaId === v.id)?.allCertified
            ? "certified"
            : "training";
      return { id: v.id, name: v.full_name || v.email, email: v.email, startDate: v.va_start_date, status, lastSignIn, scope: normalizeScope(v.va_scope) };
    })
    .sort((a, b) => Number(a.status === "deactivated") - Number(b.status === "deactivated"));
}

// Creates the login (or reuses one with no role yet) and the VA profile, then
// emails the sign-in link. Returns the message to show.
export async function inviteVa(input: {
  officeId: string;
  name: string;
  email: string;
  startDate: string;
  origin: string | null;
  // What this VA does; all roles when left out.
  scope?: ScopeKey[];
}): Promise<{ ok: boolean; message: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || name.length > 200) return { ok: false, message: "Enter the VA's name." };
  if (!EMAIL.test(email) || email.length > 320) return { ok: false, message: "Enter a valid email address." };
  if (!validDate(input.startDate)) return { ok: false, message: "Pick the training start date." };

  const db = createAdminClient();
  const { data: office } = await db.from("offices").select("id, name").eq("id", input.officeId).maybeSingle();
  if (!office) return { ok: false, message: "Office not found." };

  // Someone with this email may already have signed in.
  const { data: existing } = await db
    .from("profiles")
    .select("id, role, office_id")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();
  if (existing?.role) {
    const where = existing.role === "va" && existing.office_id !== office.id ? " at another office (use Move there)" : "";
    return { ok: false, message: `${email} already has access as ${existing.role}${where}.` };
  }

  const link = await signInLink(db, email, existing ? "magiclink" : "invite", name, input.origin);
  if ("error" in link) return { ok: false, message: `Couldn't create the login: ${link.error}` };

  // The new-user trigger creates the profile; upsert covers any gap.
  const { error: profileError } = await db.from("profiles").upsert(
    {
      id: link.userId,
      email,
      full_name: name,
      role: "va",
      office_id: office.id,
      va_start_date: input.startDate,
      deactivated_at: null,
      va_scope: scopeColumn(input.scope ?? SCOPE_KEYS),
    },
    { onConflict: "id" },
  );
  if (profileError) return { ok: false, message: "The login was created, but giving VA access failed. Try again." };

  const sendError = await emailLink(email, name, office.name, input.startDate, link.url, link.userId);
  return sendError
    ? { ok: true, message: `${name} added, but the email didn't go out (${sendError}). Use "Send sign-in link" once email works.` }
    : { ok: true, message: `${name} added. Sign-in link sent to ${email}.` };
}

// A fresh sign-in link by email, for a VA who lost or let the first one expire.
export async function resendVaLink(vaId: string, origin: string | null): Promise<string | null> {
  const db = createAdminClient();
  const { data: va } = await db
    .from("profiles")
    .select("id, email, full_name, office_id, va_start_date, deactivated_at, role")
    .eq("id", vaId)
    .maybeSingle();
  if (va?.role !== "va" || !va.office_id) return "VA not found.";
  if (va.deactivated_at) return "This VA is deactivated. Reactivate them first.";
  const { data: office } = await db.from("offices").select("name").eq("id", va.office_id).maybeSingle();
  const link = await signInLink(db, va.email, "magiclink", va.full_name, origin);
  if ("error" in link) return `Couldn't create the link: ${link.error}`;
  const sendError = await emailLink(va.email, va.full_name || va.email, office?.name ?? "", va.va_start_date, link.url, va.id);
  return sendError ? `The email didn't go out: ${sendError}` : null;
}

// Moves the VA: their training starts again at the new office on `startDate`;
// what they did at the old office stays there.
export async function moveVa(vaId: string, officeId: string, startDate: string): Promise<string | null> {
  if (!validDate(startDate)) return "Pick the training start date at the new office.";
  const db = createAdminClient();
  const [{ data: va }, { data: office }] = await Promise.all([
    db.from("profiles").select("role, office_id").eq("id", vaId).maybeSingle(),
    db.from("offices").select("id").eq("id", officeId).maybeSingle(),
  ]);
  if (va?.role !== "va") return "VA not found.";
  if (!office) return "Office not found.";
  if (va.office_id === officeId) return "The VA is already at this office.";
  const { error } = await db.from("profiles").update({ office_id: officeId, va_start_date: startDate }).eq("id", vaId).eq("role", "va");
  return error ? "Couldn't move the VA. Try again." : null;
}

// Everything is stored as null (the default), so roles added later are included.
const scopeColumn = (scope: ScopeKey[]) => (SCOPE_KEYS.every((k) => scope.includes(k)) ? null : scope);

// "What this VA does": changes which days come next. Days already started,
// and every score, stay.
export async function setVaScope(vaId: string, scope: ScopeKey[]): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db.from("profiles").update({ va_scope: scopeColumn(scope) }).eq("id", vaId).eq("role", "va").select("id");
  if (error || !data?.length) return "Couldn't save. Try again.";
  await recalculateCertifications(vaId);
  return null;
}

// Deactivated: no access at all (the login is blocked too). Their history stays.
export async function setVaActive(vaId: string, active: boolean): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("profiles")
    .update({ deactivated_at: active ? null : new Date().toISOString() })
    .eq("id", vaId)
    .eq("role", "va")
    .select("id");
  if (error || !data?.length) return "Couldn't save. Try again.";
  const { error: banError } = await db.auth.admin.updateUserById(vaId, { ban_duration: active ? "none" : BANNED });
  // The profile change alone already blocks every page and query.
  if (banError) console.error(`VA ${vaId}: login ${active ? "unblock" : "block"} failed: ${banError.message}`);
  return null;
}

// ---------------------------------------------------------------------------

// A one-time sign-in link that lands on /auth/callback (token hash, so it
// works without the browser that asked for it). Supabase sends nothing.
export async function signInLink(
  db: Db,
  email: string,
  type: "invite" | "magiclink",
  name: string,
  origin: string | null,
): Promise<{ userId: string; url: string } | { error: string }> {
  const base = (origin || appUrl()).replace(/\/+$/, "");
  const { data, error } =
    type === "invite"
      ? await db.auth.admin.generateLink({ type, email, options: { data: { full_name: name }, redirectTo: `${base}/auth/callback` } })
      : await db.auth.admin.generateLink({ type, email, options: { redirectTo: `${base}/auth/callback` } });
  if (error || !data.user || !data.properties?.hashed_token) return { error: error?.message ?? "no link returned" };
  const params = new URLSearchParams({ token_hash: data.properties.hashed_token, type: data.properties.verification_type || type });
  return { userId: data.user.id, url: `${base}/auth/callback?${params}` };
}

async function emailLink(to: string, name: string, office: string, startDate: string | null, url: string, userId: string) {
  const start = startDate ? `Your training starts ${showDate(startDate)}.` : "";
  const login = `${appUrl()}/login`;
  const subject = `Your VFDA training login${office ? ` – ${office}` : ""}`;
  const text = [
    `Hi ${name},`,
    "",
    `VFDA has set up your VA training${office ? ` for ${office}` : ""}. ${start}`.trim(),
    "",
    `Sign in: ${url}`,
    "",
    `The link works once and expires soon. If it has expired, go to ${login} and enter this email address to get a new one.`,
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>VFDA has set up your VA training${office ? ` for <strong>${escapeHtml(office)}</strong>` : ""}. ${escapeHtml(start)}</p>
<p><a href="${escapeHtml(url)}">Sign in to your training</a></p>
<p style="color:#666">The link works once and expires soon. If it has expired, go to <a href="${escapeHtml(login)}">${escapeHtml(login)}</a> and enter this email address to get a new one.</p>`;
  // One key for both tries, so a retry never sends it twice.
  const key = `va-invite:${userId}:${Date.now()}`;
  return tryTwice(() => sendEmail(to, subject, html, text, key));
}

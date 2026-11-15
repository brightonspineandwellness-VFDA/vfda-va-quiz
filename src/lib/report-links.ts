import "server-only";

// Permanent, no-login links to stored report PDFs (/r/<token>): quiz
// reports, weekly summaries and handoff guides. The token is the PDF's
// storage path plus an HMAC of it, so it can't be guessed or changed, and it
// never expires: the route streams the stored copy, which the app replaces
// whenever it remakes the PDF. Replaces the 30-day Supabase signed links in
// Leads4Life, so a doctor can open an old report any time.
// The key is REPORT_LINK_SECRET, else the service role key (server only).

import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/reports";

const SIG_LENGTH = 32;

function secret() {
  const s = process.env.REPORT_LINK_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!s) throw new Error("Report links aren't set up: REPORT_LINK_SECRET or SUPABASE_SERVICE_ROLE_KEY is needed.");
  return s;
}

const sign = (path: string) => createHmac("sha256", secret()).update(`report-pdf:${path}`).digest("base64url").slice(0, SIG_LENGTH);

// "<base64url path>.<signature>"
export const reportToken = (path: string) => `${Buffer.from(path, "utf8").toString("base64url")}.${sign(path)}`;

// The stored PDF's path, or null when the token isn't one of ours.
export function pathOfToken(token: string): string | null {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig || sig.length !== SIG_LENGTH) return null;
  let path: string;
  try {
    path = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!path || path.includes("..") || !path.endsWith(".pdf")) return null;
  const expected = Buffer.from(sign(path));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? path : null;
}

// The link sent to doctors (Leads4Life) and VFDA (Slack).
export const permanentReportLink = (path: string) => `${appUrl()}/r/${reportToken(path)}`;

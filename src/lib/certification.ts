// Workflow certification (SPEC section 6, settings.certification), as pure
// functions. The office's Trello board is the SOP: VFDA confirms on Trello
// that the doctor approved the card, and sets sop_status here.
// src/lib/certifications.ts loads the data and saves the result. Nothing is
// assigned automatically: VFDA decides the follow-up for Coaching needed.

export type CertStatus = "pending" | "coaching" | "certified";
export type SopStatus = "pending" | "approved" | "needs_changes" | "rejected";

export const CERT_LABELS: Record<CertStatus, string> = { pending: "Pending", coaching: "Coaching needed", certified: "Certified" };

// Older rows may still say "retrain" until the SQL renames it.
export const certStatus = (s: string): CertStatus => (s === "certified" ? "certified" : s === "pending" ? "pending" : "coaching");

export const SOP_LABELS: Record<SopStatus, string> = {
  pending: "waiting for VFDA to confirm",
  approved: "doctor approved on Trello",
  needs_changes: "needs changes",
  rejected: "rejected",
};

// Gray card workflows have no outline of their own; the standard one fits.
export const DEFAULT_SOP_OUTLINE = [
  "Trigger",
  "Required information",
  "Steps in order",
  "What I can decide",
  "What needs approval",
  "When I escalate immediately",
  "How I document it",
  "Definition of done",
];

export const RECHECK_ITEMS = 5;
export const DEFAULT_RECHECK_DAYS = 90;
// An SOP link waiting longer than this is flagged for VFDA.
export const SOP_WAIT_FLAG_DAYS = 3;

// One graded item of the workflow, after any VFDA override.
export type EvidenceItem = {
  type: "mc" | "situational" | "describe";
  points: number;
  first_score: number | null;
  repeat_score: number | null;
  repeated: boolean;
  critical_error: boolean;
};

// The share of first-try points the workflow's pass_standard asks for
// ("80% with zero critical errors ..."); 80% when it names none.
export function passPercent(passStandard: string | null | undefined): number {
  const m = /(\d{1,3})\s*%/.exec(passStandard ?? "");
  const n = m ? Number(m[1]) : 80;
  return n > 0 && n <= 100 ? n : 80;
}

// Certified: every scenario done, no critical error in the workflow, first-try
// average at the pass standard (80%), SOP approved on Trello.
// Coaching needed: all its scenarios done but below that (or the SOP rejected).
// Pending: not finished yet (scenarios, a grade VFDA still owes, or the SOP).
export function evaluateWorkflow(input: {
  items: EvidenceItem[];
  // Every scenario of the workflow answered (all its days, or the recheck, submitted).
  allDone: boolean;
  passStandard: string | null;
  sopStatus: SopStatus;
  sopSubmitted: boolean;
}): { status: CertStatus; reason: string; percent: number | null } {
  const { items, sopStatus } = input;
  const graded = items.filter((i) => i.first_score !== null);
  const max = graded.reduce((n, i) => n + i.points, 0);
  const points = graded.reduce((n, i) => n + (i.first_score ?? 0), 0);
  const percent = max > 0 ? Math.round((points * 100) / max) : null;

  if (!input.allDone || !items.length) return { status: "pending", reason: "scenarios not finished yet", percent };
  if (items.some((i) => i.type !== "mc" && i.first_score === null)) {
    return { status: "pending", reason: "an answer needs VFDA to score it", percent };
  }
  if (items.some((i) => i.critical_error)) return { status: "coaching", reason: "critical error", percent };
  const need = passPercent(input.passStandard);
  if (max > 0 && points * 100 < need * max) {
    return { status: "coaching", reason: `first-try average ${percent}% (needs ${need}%)`, percent };
  }
  if (sopStatus === "rejected") return { status: "coaching", reason: "SOP rejected", percent };
  if (sopStatus !== "approved") {
    return {
      status: "pending",
      reason: !input.sopSubmitted
        ? "Trello card not updated yet"
        : sopStatus === "needs_changes"
          ? "Trello card needs changes"
          : "waiting for VFDA to confirm the Trello card",
      percent,
    };
  }
  return { status: "certified", reason: "", percent };
}

// "https://trello.com/c/…" links, one per line (or separated by spaces).
export function parseTrelloLinks(raw: string): { links: string[]; error: string | null } {
  const parts = raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return { links: [], error: "Paste the Trello card link." };
  const links: string[] = [];
  for (const p of parts) {
    let url: URL;
    try {
      url = new URL(p);
    } catch {
      return { links: [], error: `"${p.slice(0, 60)}" isn't a link.` };
    }
    if (!p.startsWith("https://trello.com/c/") || url.hostname !== "trello.com" || url.pathname.length <= 3) {
      return { links: [], error: "Each link must be a Trello card link starting with https://trello.com/c/" };
    }
    if (!links.includes(url.href)) links.push(url.href);
  }
  if (links.length > 10) return { links: [], error: "Up to 10 card links." };
  return { links, error: null };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - new Date(from).getTime()) / 86400000);

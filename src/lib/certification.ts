// Workflow certification (SPEC section 6, settings.certification), as pure
// functions. The office's Trello board is the SOP: VFDA confirms on Trello
// that the doctor approved the card, and sets sop_status here.
// src/lib/certifications.ts loads the data, saves the result and assigns
// retrains.

export type CertStatus = "pending" | "retrain" | "certified";
export type SopStatus = "pending" | "approved" | "needs_changes" | "rejected";

export const CERT_LABELS: Record<CertStatus, string> = { pending: "Pending", retrain: "Retrain", certified: "Certified" };

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
  type: "mc" | "situational";
  points: number;
  first_score: number | null;
  repeat_score: number | null;
  repeated: boolean;
  critical_error: boolean;
};

export type LatestDrill = { kind: "retrain" | "recheck"; result: "pass" | "review" | "retake" | null } | null;

// The share of first-try points the workflow's pass_standard asks for
// ("80% with zero critical errors ..."); 80% when it names none.
export function passPercent(passStandard: string | null | undefined): number {
  const m = /(\d{1,3})\s*%/.exec(passStandard ?? "");
  const n = m ? Number(m[1]) : 80;
  return n > 0 && n <= 100 ? n : 80;
}

export function evaluateWorkflow(input: {
  items: EvidenceItem[];
  passStandard: string | null;
  sopStatus: SopStatus;
  sopSubmitted: boolean;
  latestDrill: LatestDrill;
  current: CertStatus;
}): { status: CertStatus; reason: string } {
  const { items, sopStatus, latestDrill } = input;

  // A recheck VFDA hasn't decided yet changes nothing.
  if (latestDrill?.kind === "recheck" && latestDrill.result === "review") return { status: input.current, reason: "recheck waiting for VFDA" };

  // Retrain: a critical error, a repeat still below 2/2, a failed recheck or a rejected SOP.
  const recheck = latestDrill?.kind === "recheck";
  if (sopStatus === "rejected") return { status: "retrain", reason: "SOP rejected" };
  if (recheck && latestDrill.result === "retake") return { status: "retrain", reason: "failed the recheck" };
  if (!recheck) {
    if (items.some((i) => i.critical_error)) return { status: "retrain", reason: "critical error" };
    if (items.some((i) => i.repeated && i.repeat_score !== null && i.repeat_score < 2)) {
      return { status: "retrain", reason: "a repeat still below 2/2" };
    }
  }

  // Certified: every scenario passed or corrected, pass_standard met, SOP approved.
  let missing: string | null = null;
  if (recheck) {
    if (latestDrill.result !== "pass") missing = "recheck not finished";
  } else if (!items.length) missing = "no scenarios done yet";
  else if (items.some((i) => i.type === "situational" && i.first_score === null && i.repeat_score === null)) {
    missing = "an answer needs VFDA review";
  } else if (items.some((i) => i.type === "situational" && i.first_score !== 2 && i.repeat_score !== 2)) {
    missing = "a missed item wasn't corrected";
  } else {
    // A miss corrected on repeat counts as passed, as above.
    const max = items.reduce((n, i) => n + i.points, 0);
    const got = items.reduce((n, i) => n + Math.max(i.first_score ?? 0, i.repeat_score ?? 0), 0);
    const need = passPercent(input.passStandard);
    if (max > 0 && (got * 100) / max < need) missing = `below the ${need}% pass standard`;
  }
  if (missing) return { status: "pending", reason: missing };
  if (sopStatus !== "approved") {
    return {
      status: "pending",
      reason: !input.sopSubmitted
        ? "Trello card not updated yet"
        : sopStatus === "needs_changes"
          ? "Trello card needs changes"
          : "waiting for VFDA to confirm the Trello card",
    };
  }
  return { status: "certified", reason: "" };
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

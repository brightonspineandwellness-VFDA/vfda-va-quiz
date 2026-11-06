// The office SOP gap report (VFDA only), as pure functions: what the office's
// cards miss against the VFDA standards and the 10 workflows, where they say
// something different, what they only half cover, safety items first, and
// how it reads as an email, a Slack post and a PDF. src/lib/office-reports.ts
// loads the data, asks Claude and sends it. No server-only imports, so tests
// can load it.

import { HIGH_PRIORITY_TOPICS, squashText, tokens } from "@/lib/card-map";

export type ReportQuote = { card: string; quote: string };

export type GapKind = "missing" | "conflict" | "partial";

export type GapItem = {
  id: string; // "rule:CONFIRM_RULE", "step:WF01:3", "escalation:WF01:1"
  kind: GapKind;
  workflow: string | null;
  workflowName: string;
  label: string;
  // The VFDA standard or workflow step, and (conflict, partial) what the card says, and which card.
  vfda: string;
  office: string | null;
  card?: string | null;
  quotes: ReportQuote[];
  note: string;
  // Emergencies, red flags, patient ID, privacy or VA limits: high priority.
  safety: boolean;
};

export type OfficeReportContent = {
  officeName: string;
  primaryDoctor?: string | null;
  generatedAt: string;
  cards: string[];
  // How the steps were checked against the cards.
  method: "claude" | "word_match";
  warning: string | null;
  // Missing or conflicting safety items, high priority (not repeated below).
  safety: GapItem[];
  // Checklist topics the office marked "We don't have this card" (reports
  // written before this existed have none).
  missingCards?: GapItem[];
  // Every checklist topic with no card uploaded (marked or not).
  noCardTopics?: string[];
  missing: { workflow: string | null; name: string; items: GapItem[] }[];
  conflicts: GapItem[];
  partial: GapItem[];
  coaching: string[];
};

export type ReportCounts = { safety: number; missingCards: number; missing: number; conflicts: number; partial: number };

export const reportCounts = (c: OfficeReportContent): ReportCounts => ({
  safety: c.safety.length,
  missingCards: c.missingCards?.length ?? 0,
  missing: c.missing.reduce((n, g) => n + g.items.length, 0),
  conflicts: c.conflicts.length,
  partial: c.partial.length,
});

// ---------------------------------------------------------------------------
// Safety: emergencies, red flags, patient ID, privacy, VA limits.
// ---------------------------------------------------------------------------

const SAFETY_KEYS = new Set([
  "EMERGENCY_PROTOCOL",
  "RED_FLAGS",
  "URGENT_RULE",
  "PATIENT_ID_CHECK",
  "PHI_CHANNEL_RULE",
  "VA_AUTHORITY",
  "PROHIBITED_PHRASES",
  "ESCALATION_CONTACT",
  "BILLING_AUTHORITY",
  "PRIVACY_RULE",
  "HIPAA_RULE",
]);
const SAFETY_WORDS =
  /emergenc|\b911\b|red.?flag|chest pain|stroke|suicid|self-harm|urgent|identit|identif(?:y|ies|ication)|date of birth|\bdob\b|verify(?:ing)? (?:the )?(?:patient|caller)|privacy|hipaa|\bphi\b|confidential|patient information|medical advice|clinical advice|diagnos|never say|never promise|authority|needs? (?:the doctor|approval)|without approval/i;

export const isSafety = (text: string, key?: string | null) => (!!key && SAFETY_KEYS.has(key)) || SAFETY_WORDS.test(text);

// ---------------------------------------------------------------------------
// Inputs (src/lib/office-reports.ts builds them)
// ---------------------------------------------------------------------------

export type ReportCard = { id: string; title: string; text: string };

// A workflow step or immediate-escalation rule, with the office's own rule
// values filled in where known.
export type Checkpoint = { id: string; workflow: string; workflowName: string; label: string; text: string; escalation: boolean };

export type CheckVerdict = {
  status: "covered" | "partial" | "missing" | "conflict";
  card: string | null;
  quote: string | null;
  cardSays: string | null;
};

export type StandardInput = {
  key: string;
  question: string;
  mustAsk: boolean;
  workflows: { code: string; name: string }[];
  // The VFDA standard (default answer or suggestion), as text; null if there's none.
  standard: string | null;
  // Accepted card versions (VFDA reviewed), and the doctor's own answer.
  cardVersions: { text: string; card: string; quote: string | null; partial: boolean }[];
  doctor: { text: string; card: string | null; quote: string | null } | null;
};

// Rule versions Claude (or the word check) compared with the standard, one per
// card (versionId).
export type RuleVerdict = "same" | "different";
export const versionId = (key: string, card: string) => `${key}|${card}`;

export const sameText = (a: string, b: string) => squashText(a).replace(/[.\s]+$/, "") === squashText(b).replace(/[.\s]+$/, "");

// Without Claude: a checkpoint is covered when one card has most of its words.
export function wordMatch(checkpoint: Pick<Checkpoint, "text">, cards: ReportCard[]): CheckVerdict {
  const want = [...tokens(checkpoint.text.replace(/\{[A-Z0-9_]+\}/g, " "))].filter((t) => t.length > 3);
  if (!want.length) return { status: "missing", card: null, quote: null, cardSays: null };
  let best: { card: ReportCard; share: number } | null = null;
  for (const card of cards) {
    const have = tokens(card.text);
    const share = want.filter((t) => have.has(t)).length / want.length;
    if (!best || share > best.share) best = { card, share };
  }
  if (!best || best.share < 0.35) return { status: "missing", card: null, quote: null, cardSays: null };
  return { status: best.share >= 0.7 ? "covered" : "partial", card: best.card.title, quote: null, cardSays: null };
}

const one = (v: StandardInput) => v.workflows[0] ?? { code: null, name: "General" };

// The report's findings, before coaching points. Steps are checked by
// `verdicts` (Claude, or wordMatch); standards from the office's rules.
export function buildFindings(input: {
  checkpoints: Checkpoint[];
  verdicts: Map<string, CheckVerdict>;
  standards: StandardInput[];
  ruleVerdicts: Map<string, RuleVerdict>;
}) {
  const items: GapItem[] = [];

  for (const s of input.standards) {
    const w = one(s);
    const safety = isSafety(`${s.question} ${s.standard ?? ""}`, s.key);
    const base = {
      workflow: w.code,
      workflowName: w.name,
      label: `${s.mustAsk ? "Office rule" : "VFDA standard"}: ${s.question}`,
      vfda: s.standard ?? "(no VFDA standard: agree it with the doctor)",
      safety,
    };
    // Each card on its own against the standard: two of the office's own
    // cards may differ (different processes), that's never flagged.
    const versions = [
      ...s.cardVersions.map((v) => ({ ...v, id: versionId(s.key, v.card) })),
      ...(s.doctor?.card ? [{ text: s.doctor.text, card: s.doctor.card, quote: s.doctor.quote, partial: false, id: versionId(s.key, s.doctor.card) }] : []),
    ];
    for (const v of versions) {
      const quotes = v.quote ? [{ card: v.card, quote: v.quote }] : [];
      if (s.standard && input.ruleVerdicts.get(v.id) === "different") {
        items.push({ ...base, id: `rule:${s.key}:${v.card}`, kind: "conflict", office: v.text, card: v.card, quotes, note: "The card is different from the VFDA standard." });
      } else if (v.partial) {
        items.push({ ...base, id: `rule:${s.key}:${v.card}`, kind: "partial", office: v.text, card: v.card, quotes, note: "The card covers only part of this." });
      }
    }
    if (!versions.length) {
      items.push({
        ...base,
        id: `rule:${s.key}`,
        kind: "missing",
        office: null,
        quotes: [],
        note: s.doctor
          ? `Not on the cards; set in the app: ${s.doctor.text}`
          : s.standard
            ? "Not on the cards; the VFDA standard applies."
            : "Not on the cards, and no VFDA standard.",
      });
    }
  }

  for (const c of input.checkpoints) {
    const v = input.verdicts.get(c.id) ?? { status: "missing", card: null, quote: null, cardSays: null };
    if (v.status === "covered") continue;
    const quotes = v.card && v.quote ? [{ card: v.card, quote: v.quote }] : [];
    const safety = c.escalation || isSafety(c.text);
    const base = { id: c.id, workflow: c.workflow, workflowName: c.workflowName, label: c.label, vfda: c.text, safety, quotes };
    if (v.status === "conflict") items.push({ ...base, kind: "conflict", office: v.cardSays, card: v.card, note: `${v.card ?? "A card"} says something different.` });
    else if (v.status === "partial") items.push({ ...base, kind: "partial", office: v.cardSays, card: v.card, note: `${v.card ?? "A card"} covers only part of this step.` });
    else items.push({ ...base, kind: "missing", office: null, note: "No card covers this step." });
  }

  // Safety first: missing or conflicting safety items go to the top.
  const top = items.filter((i) => i.safety && i.kind !== "partial");
  const rest = items.filter((i) => !top.includes(i));
  const groups = new Map<string, { workflow: string | null; name: string; items: GapItem[] }>();
  for (const i of rest.filter((x) => x.kind === "missing")) {
    const k = i.workflow ?? "";
    if (!groups.has(k)) groups.set(k, { workflow: i.workflow, name: i.workflowName, items: [] });
    groups.get(k)!.items.push(i);
  }
  const order = (code: string | null) => (code ? code : "~");
  return {
    safety: top,
    missing: [...groups.values()].sort((a, b) => order(a.workflow).localeCompare(order(b.workflow))),
    conflicts: rest.filter((i) => i.kind === "conflict"),
    // Partial safety items stay here, marked high priority, and come first.
    partial: rest.filter((i) => i.kind === "partial").sort((a, b) => Number(b.safety) - Number(a.safety)),
  };
}

// "We don't have this card": one item per topic, phones, escalation and new
// patients first (high priority).
export function missingCardItems(topics: { name: string; days: string[]; markedBy: string | null }[]): GapItem[] {
  return topics
    .map((t) => {
      const high = t.name in HIGH_PRIORITY_TOPICS;
      return {
        id: `card:${t.name}`,
        kind: "missing" as const,
        workflow: null,
        workflowName: "Missing cards",
        label: `No ${t.name} card`,
        vfda: t.days.length
          ? `${t.days.join(", ")} ${t.days.length > 1 ? "are" : "is"} built from the VFDA master bank and standards ("VFDA standard – office has no card").`
          : "VFDA standards are used for this topic.",
        office: null,
        quotes: [],
        note: `${high ? `High priority (${HIGH_PRIORITY_TOPICS[t.name]}). ` : ""}Marked "We don't have this card"${t.markedBy ? ` by ${t.markedBy}` : ""}.`,
        safety: high,
      };
    })
    .sort((a, b) => Number(b.safety) - Number(a.safety));
}

// Coaching points without Claude (AI_MODE=mock, or Claude failed).
export function fallbackCoaching(f: ReturnType<typeof buildFindings>, missingCards: GapItem[] = []): string[] {
  const points: string[] = [];
  const urgent = missingCards.filter((c) => c.safety);
  if (urgent.length) points.push(`Ask the doctor to write the missing ${urgent.map((c) => c.label.replace(/^No | card$/g, "")).join(", ")} card${urgent.length > 1 ? "s" : ""}: until then the VA learns only VFDA's standard way.`);
  if (f.safety.length) {
    points.push(`Start with safety: ${f.safety.slice(0, 3).map((i) => i.label.replace(/^[^:]+: /, "")).join("; ")}. Agree how the VA handles these and add them to the cards.`);
  }
  const biggest = [...f.missing].sort((a, b) => b.items.length - a.items.length)[0];
  if (biggest) points.push(`${biggest.name} has the most gaps (${biggest.items.length}). Walk through the workflow with the doctor and add the missing steps to a card.`);
  if (f.conflicts.length) points.push(`Settle ${f.conflicts.length} place(s) where the cards say something different from VFDA's standard, so the VA has one answer.`);
  if (f.partial.length) points.push(`Fill in ${f.partial.length} rule(s) or step(s) the cards only half cover.`);
  points.push("Ask the doctor to keep the cards as the single source: when a rule changes, update the card and tell VFDA.");
  return points.slice(0, 5);
}

// ---------------------------------------------------------------------------
// How it reads: one list of blocks for the email, the page and the PDF.
// ---------------------------------------------------------------------------

export type Block =
  | { type: "title" | "heading" | "subheading" | "text" | "muted"; text: string }
  | { type: "item"; item: GapItem; high: boolean };

const KIND_LABELS: Record<GapKind, string> = { missing: "Missing", conflict: "Conflict", partial: "Partial" };

export function reportBlocks(c: OfficeReportContent): Block[] {
  const counts = reportCounts(c);
  const b: Block[] = [
    { type: "title", text: `Office SOP gap report: ${c.officeName}` },
    {
      type: "muted",
      text: `VFDA only, not for the doctors. ${c.primaryDoctor ? `Primary doctor: ${c.primaryDoctor}. ` : ""}${new Date(c.generatedAt).toUTCString()}. Cards compared: ${c.cards.join(", ") || "none"}.`,
    },
    {
      type: "text",
      text: `${counts.safety} safety first · ${counts.missingCards} missing cards · ${counts.missing} missing · ${counts.conflicts} conflicts · ${counts.partial} partial`,
    },
  ];
  if (c.warning) b.push({ type: "muted", text: c.warning });
  b.push({ type: "heading", text: "Safety first (high priority)" });
  if (!c.safety.length) b.push({ type: "muted", text: "Nothing missing or conflicting about emergencies, red flags, patient ID, privacy or VA limits." });
  for (const item of c.safety) b.push({ type: "item", item, high: true });
  b.push({ type: "heading", text: "Missing cards" });
  if (!c.missingCards?.length) b.push({ type: "muted", text: "None: the office has a card for every topic (or hasn't said otherwise)." });
  for (const item of c.missingCards ?? []) b.push({ type: "item", item, high: item.safety });
  b.push({ type: "heading", text: "Missing: what the cards don't cover" });
  if (!c.missing.length) b.push({ type: "muted", text: "Nothing." });
  for (const g of c.missing) {
    b.push({ type: "subheading", text: g.workflow ? `${g.workflow} ${g.name}` : g.name });
    for (const item of g.items) b.push({ type: "item", item, high: false });
  }
  b.push({ type: "heading", text: "Conflicts: the cards vs the VFDA standard" });
  if (!c.conflicts.length) b.push({ type: "muted", text: "Nothing." });
  for (const item of c.conflicts) b.push({ type: "item", item, high: false });
  b.push({ type: "heading", text: "Partial: only half covered" });
  if (!c.partial.length) b.push({ type: "muted", text: "Nothing." });
  for (const item of c.partial) b.push({ type: "item", item, high: item.safety });
  b.push({ type: "heading", text: "Coaching points for Dr. Matt" });
  c.coaching.forEach((p, i) => b.push({ type: "text", text: `${i + 1}. ${p}` }));
  return b;
}

// An item's lines: kind and label, then the VFDA version and the card's, quotes, note.
export function itemLines(i: GapItem, high: boolean) {
  return {
    title: `${high ? "HIGH PRIORITY · " : ""}${KIND_LABELS[i.kind]}${i.workflow ? ` · ${i.workflow}` : ""} · ${i.label}`,
    vfda: `VFDA: ${i.vfda}`,
    office: i.office ? `Card${i.card ? ` (${i.card})` : ""}: ${i.office}` : null,
    quotes: i.quotes.map((q) => `${q.card}: "${q.quote}"`),
    note: i.note,
  };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Slack: 3 lines (office, counts, link).
export function reportSlack(c: OfficeReportContent, link: string) {
  const b = briefReport(c);
  return {
    text: [
      `*${slackEscape(`VFDA report: ${c.officeName}`)}*${b.doctor ? ` · ${slackEscape(b.doctor)}` : ""}`,
      `${b.counts.safety ? ":rotating_light: " : ""}Safety ${b.counts.safety} · Missing ${b.counts.missing} · Different ${b.counts.different} · ${b.missingCards.length} topic(s) without a card`,
      `<${link}|Open the report> (VFDA only)`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// The brief: what the PDF, the email and Slack carry. Bullets only, one line
// each, plain language, against the VFDA standard; no quotes (they stay on
// the admin page). Each list stops at 10 with "+N more on the admin page".
// ---------------------------------------------------------------------------

const SAFETY_TOPICS: Record<string, string> = {
  RED_FLAGS: "Red flags",
  EMERGENCY_PROTOCOL: "Emergency script",
  PATIENT_ID_CHECK: "Patient ID check",
  PHI_CHANNEL_RULE: "Privacy (patient information)",
};
const LIMIT = 10;
// One line on the PDF (Letter, 9 pt Helvetica).
const LINE = 110;

// One line: whitespace squashed, cut with an ellipsis.
export const oneLine = (s: string, max = LINE) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const topicOf = (i: GapItem) => i.label.replace(/^[^:]+:\s*/, "").replace(/\?$/, "");
// A rule's short name from its key: NO_SHOW_RULE -> "No-show", EOD_REPORT -> "EOD report".
const ACRONYMS = new Set(["eod", "phi", "id", "np", "va", "rof", "ehr"]);
export function ruleName(i: Pick<GapItem, "id" | "label">) {
  const key = /^rule:([A-Z0-9_]+)/.exec(i.id)?.[1];
  if (!key) return topicOf(i as GapItem);
  const words = key.toLowerCase().replace(/_rule$/, "").split("_").map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const name = words.join(words.length === 2 && ["no", "same", "after", "out", "follow"].includes(words[0]) ? "-" : " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}
const cardOf = (i: GapItem) => i.card || "A card";
// Each part shortened on its own, so both sides of a comparison always show.
const part = (s: string | null | undefined, max: number) => oneLine(s ?? "", max);

export type BriefList = { shown: string[]; more: number; total: number };
export type Brief = {
  officeName: string;
  doctor: string | null;
  date: string;
  cards: string[];
  counts: { safety: number; missing: number; different: number };
  safety: string[];
  missing: BriefList;
  different: BriefList;
  missingCards: string[];
  coaching: string[];
};

const cut = (lines: string[]): BriefList => ({ shown: lines.slice(0, LIMIT), more: Math.max(0, lines.length - LIMIT), total: lines.length });

export function briefReport(c: OfficeReportContent): Brief {
  const all = [...c.safety, ...c.missing.flatMap((g) => g.items), ...c.conflicts, ...c.partial];
  const locked = (i: GapItem) => Object.keys(SAFETY_TOPICS).find((k) => i.id === `rule:${k}` || i.id.startsWith(`rule:${k}:`));

  // Safety: the cards against the four safety standards (always VFDA's).
  const safety = Object.entries(SAFETY_TOPICS).flatMap(([key, topic]) =>
    all
      .filter((i) => locked(i) === key && i.kind !== "partial")
      .map((i) =>
        i.kind === "missing"
          ? oneLine(`${topic}: no card covers it – VFDA standard applies`)
          : oneLine(`${topic}: ${part(cardOf(i), 24)} says "${part(i.office, 34)}" – VFDA standard applies`),
      ),
  );

  // Missing, most important first: safety, office rules, VFDA standards, partly covered, then workflow steps.
  const rank = (i: GapItem) =>
    (i.safety ? 0 : 10) + (i.id.startsWith("rule:") ? (i.label.startsWith("Office rule") ? 0 : 1) : i.kind === "partial" ? 2 : i.id.startsWith("escalation:") ? 3 : 4);
  const missing = all
    .filter((i) => !locked(i) && (i.kind === "missing" || i.kind === "partial"))
    .sort((a, b) => rank(a) - rank(b))
    .map((i) => {
      if (i.kind === "partial") return oneLine(`${part(i.id.startsWith("rule:") ? ruleName(i) : topicOf(i), 30)}: only partly on ${part(cardOf(i), 24)} – VFDA: ${part(i.vfda, 34)}`);
      if (i.id.startsWith("rule:")) {
        return i.vfda.startsWith("(no VFDA standard")
          ? oneLine(`No ${ruleName(i).toLowerCase()} rule – no VFDA default either`)
          : oneLine(`No ${part(ruleName(i).toLowerCase(), 30)} rule – using VFDA default: ${part(i.vfda, 50)}`);
      }
      return oneLine(`${part(i.workflowName, 26)}: no card covers "${part(i.vfda, 66)}"`);
    });

  const different = all
    .filter((i) => !locked(i) && i.kind === "conflict")
    .sort((a, b) => Number(b.safety) - Number(a.safety))
    .map((i) => oneLine(`${part(i.id.startsWith("rule:") ? ruleName(i) : `${i.workflowName}: ${topicOf(i)}`, 26)} – Card: ${part(i.office || "(different)", 34)} · VFDA: ${part(i.vfda, 34)}`));

  return {
    officeName: c.officeName,
    doctor: c.primaryDoctor ?? null,
    date: c.generatedAt,
    cards: c.cards,
    counts: { safety: safety.length, missing: missing.length, different: different.length },
    safety,
    missing: cut(missing),
    different: cut(different),
    missingCards: (c.noCardTopics ?? (c.missingCards ?? []).map((m) => m.label.replace(/^No | card$/g, ""))).map((t) =>
      oneLine(`${t}: no card${t in HIGH_PRIORITY_TOPICS ? ` (high priority: ${HIGH_PRIORITY_TOPICS[t]})` : ""} – VFDA standard used`),
    ),
    coaching: c.coaching.slice(0, 3).map((p) => oneLine(p, 200)),
  };
}

export function briefSubject(b: Brief) {
  return `VFDA report – ${b.officeName} – ${b.counts.safety} safety, ${b.counts.missing} missing, ${b.counts.different} different`;
}

// The brief as text lines (email), in order.
export function briefLines(b: Brief, link: string) {
  const more = (l: BriefList) => (l.more ? [`  +${l.more} more on the admin page`] : []);
  const bullets = (xs: string[], none: string) => (xs.length ? xs.map((x) => `- ${x}`) : [`- ${none}`]);
  return [
    `${b.officeName} · ${b.doctor ? `Doctor: ${b.doctor} · ` : ""}${new Date(b.date).toDateString()}`,
    `Cards uploaded (${b.cards.length}): ${b.cards.join(", ") || "none"}`,
    `Safety ${b.counts.safety} · Missing ${b.counts.missing} · Different ${b.counts.different}`,
    "",
    "SAFETY",
    ...bullets(b.safety, "Nothing: the cards don't contradict or skip the safety standards."),
    "",
    "MISSING VS VFDA STANDARD",
    ...bullets(b.missing.shown, "Nothing missing."),
    ...more(b.missing),
    "",
    "DIFFERENT FROM VFDA STANDARD",
    ...bullets(b.different.shown, "Nothing different."),
    ...more(b.different),
    "",
    "MISSING CARDS",
    ...bullets(b.missingCards, "None."),
    "",
    "COACHING POINTS FOR DR. MATT",
    ...bullets(b.coaching, "None."),
    "",
    `Full report with quotes (VFDA only): ${link}`,
  ];
}

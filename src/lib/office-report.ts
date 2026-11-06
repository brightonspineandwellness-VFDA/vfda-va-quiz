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
  // The VFDA standard or workflow step, and (conflict, partial) what the cards say.
  vfda: string;
  office: string | null;
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

// Rule versions Claude (or the word check) compared with the standard.
export type RuleVerdict = "same" | "different";

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
    const base = {
      workflow: w.code,
      workflowName: w.name,
      label: `${s.mustAsk ? "Office rule" : "VFDA standard"}: ${s.question}`,
      vfda: s.standard ?? "(no VFDA standard: agree it with the doctor)",
    };
    const id = `rule:${s.key}`;
    const safety = isSafety(`${s.question} ${s.standard ?? ""}`, s.key);
    const quotes = s.cardVersions.filter((v) => v.quote).map((v) => ({ card: v.card, quote: v.quote! }));
    const versions = s.cardVersions.filter((v, i) => s.cardVersions.findIndex((x) => sameText(x.text, v.text)) === i);
    const differs = input.ruleVerdicts.get(s.key) === "different";

    if (versions.length > 1) {
      items.push({ ...base, id, kind: "conflict", office: versions.map((v) => `${v.card}: ${v.text}`).join("\n"), quotes, note: "The cards say different things.", safety });
    } else if (versions.length === 1 && s.standard && differs) {
      items.push({ ...base, id, kind: "conflict", office: versions[0].text, quotes, note: "The card is different from the VFDA standard.", safety });
    } else if (versions.length === 1 && s.cardVersions.every((v) => v.partial)) {
      items.push({ ...base, id, kind: "partial", office: versions[0].text, quotes, note: "The card covers only part of this.", safety });
    } else if (versions.length === 0 && s.doctor?.card && s.standard && differs) {
      // The doctor's VA Office Rules card.
      items.push({
        ...base,
        id,
        kind: "conflict",
        office: s.doctor.text,
        quotes: s.doctor.quote ? [{ card: s.doctor.card, quote: s.doctor.quote }] : [],
        note: "The doctor's answer is different from VFDA's suggestion.",
        safety,
      });
    } else if (versions.length === 0 && !s.doctor?.card) {
      items.push({
        ...base,
        id,
        kind: "missing",
        office: null,
        quotes: [],
        note: s.doctor
          ? `Not on the cards; the doctor answered it in the app: ${s.doctor.text}`
          : s.standard
            ? "Not on the cards; the VFDA standard applies."
            : "Not on the cards, and no answer yet.",
        safety,
      });
    }
  }

  for (const c of input.checkpoints) {
    const v = input.verdicts.get(c.id) ?? { status: "missing", card: null, quote: null, cardSays: null };
    if (v.status === "covered") continue;
    const quotes = v.card && v.quote ? [{ card: v.card, quote: v.quote }] : [];
    const safety = c.escalation || isSafety(c.text);
    const base = { id: c.id, workflow: c.workflow, workflowName: c.workflowName, label: c.label, vfda: c.text, safety, quotes };
    if (v.status === "conflict") items.push({ ...base, kind: "conflict", office: v.cardSays, note: `${v.card ?? "A card"} says something different.` });
    else if (v.status === "partial") items.push({ ...base, kind: "partial", office: v.cardSays, note: `${v.card ?? "A card"} covers only part of this step.` });
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
    office: i.office ? `Cards: ${i.office}` : null,
    quotes: i.quotes.map((q) => `${q.card}: "${q.quote}"`),
    note: i.note,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function reportSubject(c: OfficeReportContent) {
  const n = reportCounts(c);
  return `Office SOP gap report – ${c.officeName} – ${n.safety} safety, ${n.missingCards} missing cards, ${n.missing} missing, ${n.conflicts} conflicts, ${n.partial} partial`;
}

export function reportEmailHtml(c: OfficeReportContent, link: string) {
  const e = escapeHtml;
  const html = reportBlocks(c)
    .map((b) => {
      switch (b.type) {
        case "title":
          return `<h2 style="margin:0 0 6px;font-size:18px">${e(b.text)}</h2>`;
        case "heading":
          return `<h3 style="margin:22px 0 6px;font-size:15px">${e(b.text)}</h3>`;
        case "subheading":
          return `<h4 style="margin:12px 0 4px;font-size:14px;color:#333">${e(b.text)}</h4>`;
        case "muted":
          return `<p style="margin:4px 0;color:#666">${e(b.text)}</p>`;
        case "text":
          return `<p style="margin:4px 0">${e(b.text)}</p>`;
        case "item": {
          const l = itemLines(b.item, b.high);
          const box = b.high ? "border-left:4px solid #b91c1c;background:#fdecec" : "border-left:4px solid #ccc";
          const side = l.office
            ? `<table style="border-collapse:collapse;width:100%;margin-top:4px"><tr><td style="vertical-align:top;width:50%;padding:4px 8px 4px 0">${e(l.vfda)}</td><td style="vertical-align:top;padding:4px 0">${e(l.office)}</td></tr></table>`
            : `<p style="margin:4px 0">${e(l.vfda)}</p>`;
          return `<div style="margin:6px 0;padding:6px 10px;${box}"><b>${e(l.title)}</b>${side}${l.quotes
            .map((q) => `<p style="margin:2px 0;color:#444;font-style:italic">${e(q)}</p>`)
            .join("")}<p style="margin:2px 0;color:#666">${e(l.note)}</p></div>`;
        }
      }
    })
    .join("\n");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111">${html}
<p style="margin-top:20px"><a href="${e(link)}">Open the report</a> (VFDA login required). The PDF is attached.</p></div>`;
}

export function reportEmailText(c: OfficeReportContent, link: string) {
  const lines = reportBlocks(c).flatMap((b) => {
    if (b.type !== "item") return b.type === "heading" ? ["", b.text.toUpperCase()] : [b.text];
    const l = itemLines(b.item, b.high);
    return [`- ${l.title}`, `    ${l.vfda}`, ...(l.office ? [`    ${l.office}`] : []), ...l.quotes.map((q) => `    ${q}`), `    ${l.note}`];
  });
  return `${lines.join("\n")}\n\nOpen the report (VFDA login required): ${link}`;
}

const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function reportSlack(c: OfficeReportContent, link: string) {
  const n = reportCounts(c);
  return {
    text: [
      `*${slackEscape(`Office SOP gap report: ${c.officeName}`)}*`,
      `${n.safety ? ":rotating_light: " : ""}${n.safety} safety first · ${n.missingCards} missing cards · ${n.missing} missing · ${n.conflicts} conflicts · ${n.partial} partial`,
      `<${link}|Open the report> (VFDA only)`,
    ].join("\n"),
  };
}

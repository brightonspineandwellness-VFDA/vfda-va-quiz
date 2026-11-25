import "server-only";

// Feedback after a call: Claude Opus 5.5 grades the transcript against the
// W2D1 / W2D2 phone checklist and a cadence check (did the VA book the way
// this office books?). The model only classifies each item; the result is
// decided here: Passed = no critical error and at most one missed item.
// Encouraging, like the quiz reports: no scores.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import type { StoredPersona } from "./calls";
import { sourceLabel, type CallContext } from "./rules";
import type { CadenceSource, CallType, TranscriptEntry } from "./types";

type Db = ReturnType<typeof createAdminClient>;

const MODEL = "claude-opus-5-5";

// Used when schedule_days.notes can't be read (same words as the bank).
const FALLBACK_CHECKLISTS = {
  W2D1: ["greeting", "identity", "required questions", "approved language", "documentation", "closing", "escalation"],
  W2D2: ["calm tone", "listening/empathy", "clarifying questions", "approved language", "boundaries", "escalation", "objective notes", "closing"],
};

export const checklistDay = (t: CallType): "W2D1" | "W2D2" => (t === "easy" || t === "w2d1_roleplay" ? "W2D1" : "W2D2");

export async function loadChecklist(db: Db, day: "W2D1" | "W2D2"): Promise<string[]> {
  const { data } = await db.from("schedule_days").select("notes").eq("code", day).maybeSingle();
  const notes = (data as { notes: string | null } | null)?.notes ?? "";
  const m = notes.match(/checklist:\s*([^.]+)\./i);
  const items = m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  return items.length >= 3 ? items : FALLBACK_CHECKLISTS[day];
}

const ItemStatus = z.enum(["met", "missed", "not_applicable"]);

const FeedbackSchema = z.object({
  checklist: z
    .array(
      z.object({
        item: z.string().describe("The checklist item, exactly as given"),
        status: ItemStatus,
        note: z.string().describe("One short, kind sentence to the VA (\"you\") on what happened for this item"),
      }),
    )
    .describe("One entry per checklist item, in the order given"),
  cadence: z
    .array(
      z.object({
        key: z.string().describe("The cadence rule key, exactly as given"),
        status: ItemStatus.describe("not_applicable when the call never touched this rule"),
        note: z.string().describe("One short sentence: what the VA did and what the office expects"),
      }),
    )
    .describe("One entry per cadence rule, in the order given"),
  critical_error: z.boolean().describe("A safety or privacy failure (see the rules); never for style"),
  critical_quote: z.string().nullable().describe("When critical_error is true: the VA's exact words, copied verbatim"),
  went_well: z.array(z.string()).describe("1-3 specific things the VA did well, each one short sentence to \"you\""),
  try_next: z.array(z.string()).describe("1-3 things to try next time, most important first, each phrased as what to do"),
  possible_real_data: z
    .array(z.object({ quote: z.string(), reason: z.string() }))
    .describe("Anything the VA said that looks like a REAL person's details (a real-sounding name of someone else, a birthday, a phone number other than 555-01xx). Empty if none."),
});
type Feedback = z.infer<typeof FeedbackSchema>;

export type ChecklistLine = { item: string; status: z.infer<typeof ItemStatus>; note: string; kind: "phone" | "cadence"; source?: string };
export type CallFeedback = { went_well: string[]; try_next: string[] };
export type CallFlag = { kind: "possible_real_data"; quote: string; reason: string };

export type GradedCall = {
  result: "passed" | "practice_again";
  checklist: ChecklistLine[];
  feedback: CallFeedback;
  flags: CallFlag[];
  criticalQuote: string | null;
  usage: { input: number; output: number };
};

const SYSTEM = `You review practice phone calls for virtual assistants (VAs) at chiropractic offices. The caller was an AI playing a made-up patient. Give honest, encouraging feedback a trainee can act on.

How to judge:
- Judge the approach and the main intent of each item, not exact wording. Don't penalize accent, grammar or English level.
- Speech-to-text makes mistakes. Read past garbled words when the meaning is clear.
- Items that can't happen on a phone call (for example writing notes in the EHR) are met if the VA said they'd note or document it, otherwise not_applicable unless the call clearly needed it.
- Cadence: compare what the VA booked or promised with the office's rule. not_applicable if that rule never came up.
- Care plans are explained at the office visit. Deferring the care plan to the visit is correct; setting a care plan over the phone is a miss.
- A critical error is only a safety or privacy failure: sharing a patient's details before verifying who they are, giving another patient's information, giving medical advice or a diagnosis, ignoring red-flag symptoms that need the doctor or emergency care, or promising insurance coverage as a guarantee. Quote the VA's exact words.
- Write to the VA as "you". Be warm and specific. No scores or points.`;

export async function gradeCall(input: {
  db: Db;
  callType: CallType;
  persona: StoredPersona;
  transcript: TranscriptEntry[];
  ctx: CallContext;
  sources: Record<string, CadenceSource>;
  officeId: string;
}): Promise<GradedCall> {
  const day = checklistDay(input.callType);
  const checklist = await loadChecklist(input.db, day);

  // Roleplay answer key (server only), from the office's live scenario.
  let key = "";
  if (input.persona.scenarioCode) {
    const { data } = await input.db
      .from("office_scenarios")
      .select("stem, correct_response, critical_fail")
      .eq("office_id", input.officeId)
      .eq("schedule_day", day)
      .eq("code", input.persona.scenarioCode)
      .order("build_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const s = data as { stem: string; correct_response: unknown; critical_fail: string | null } | null;
    if (s) key = `\nRoleplay scenario: ${s.stem}\nWhat a good response includes: ${JSON.stringify(s.correct_response)}${s.critical_fail ? `\nCritical fail: ${s.critical_fail}` : ""}\n`;
  }

  const scripts = Object.entries(input.ctx.scripts).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none on file)";
  const cadence = input.ctx.cadence.map((c) => `- ${c.key} (${c.label}): ${c.value}`).join("\n");
  const lines = input.transcript.map((t) => `${t.speaker === "va" ? "VA" : "Patient"}: ${t.text}`).join("\n");

  const content = `Call type: ${input.callType.replace("_", " ")}. Office: ${input.ctx.officeName}.
${key}
${day} phone checklist items (grade each):
${checklist.map((c) => `- ${c}`).join("\n")}

Cadence rules (grade each):
${cadence}

The office's phone scripts and facts:
${scripts}

Transcript:
${lines}`;

  const client = new Anthropic();
  const message = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(FeedbackSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content }],
    })
    .finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The feedback couldn't be written for this call.");
  if (message.stop_reason === "max_tokens") throw new Error("The feedback was cut off. Try again.");
  const fb = message.parsed_output as Feedback | null;
  if (!fb) throw new Error("The feedback couldn't be read. Try again.");

  return shapeGrade(fb, { checklist, ctx: input.ctx, sources: input.sources, transcript: input.transcript, usage: message.usage });
}

function shapeGrade(
  fb: Feedback,
  input: {
    checklist: string[];
    ctx: CallContext;
    sources: Record<string, CadenceSource>;
    transcript: TranscriptEntry[];
    usage: { input_tokens: number; output_tokens: number };
  },
): GradedCall {
  // Keep the given order and wording, whatever order the model used.
  const phone: ChecklistLine[] = input.checklist.map((item) => {
    const got = fb.checklist.find((c) => c.item.toLowerCase() === item.toLowerCase());
    return { item, status: got?.status ?? "not_applicable", note: got?.note ?? "", kind: "phone" };
  });
  const cadence: ChecklistLine[] = input.ctx.cadence.map((c) => {
    const got = fb.cadence.find((x) => x.key === c.key);
    return {
      item: c.label,
      status: got?.status ?? "not_applicable",
      note: got?.note ?? "",
      kind: "cadence",
      source: sourceLabel(input.sources[c.key] ?? c.source),
    };
  });

  // A critical quote must be the VA's own words.
  const vaWords = input.transcript.filter((t) => t.speaker === "va").map((t) => t.text.toLowerCase()).join(" ");
  const quote = fb.critical_error && fb.critical_quote?.trim() ? fb.critical_quote.trim() : null;
  const critical = !!quote && vaWords.replace(/\s+/g, " ").includes(quote.toLowerCase().replace(/\s+/g, " "));

  const missed = [...phone, ...cadence].filter((l) => l.status === "missed").length;
  const flags: CallFlag[] = [
    ...fb.possible_real_data.map((f) => ({ kind: "possible_real_data" as const, quote: f.quote, reason: f.reason })),
    ...realDataPatterns(input.transcript),
  ];

  return {
    result: !critical && missed <= 1 ? "passed" : "practice_again",
    checklist: [...phone, ...cadence],
    feedback: { went_well: fb.went_well.slice(0, 3), try_next: fb.try_next.slice(0, 3) },
    flags: dedupeFlags(flags),
    criticalQuote: critical ? quote : null,
    usage: { input: input.usage.input_tokens, output: input.usage.output_tokens },
  };
}

// Patterns that look like real data in what the VA said: phone numbers other
// than the fictional 555-01xx, and full dates of birth.
// Details the made-up patient said first (and the VA read back) aren't flagged.
export function realDataPatterns(transcript: TranscriptEntry[]): CallFlag[] {
  const patientSaid = transcript.filter((t) => t.speaker === "patient").map((t) => t.text.replace(/\D/g, "")).join(" ");
  const fromPatient = (q: string) => patientSaid.includes(q.replace(/\D/g, ""));
  const out: CallFlag[] = [];
  for (const t of transcript) {
    if (t.speaker !== "va") continue;
    for (const m of t.text.matchAll(/\b(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/g)) {
      if (!/555[\s.-]?01\d\d/.test(m[0])) out.push({ kind: "possible_real_data", quote: m[0], reason: "Looks like a real phone number" });
    }
    for (const m of t.text.matchAll(/\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](19|20)?\d{2}\b/g)) {
      out.push({ kind: "possible_real_data", quote: m[0], reason: "Looks like a date of birth" });
    }
  }
  return out.filter((f) => !fromPatient(f.quote));
}

const dedupeFlags = (flags: CallFlag[]) => flags.filter((f, i) => flags.findIndex((g) => g.quote === f.quote) === i).slice(0, 10);

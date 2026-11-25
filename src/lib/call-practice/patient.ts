import "server-only";

// The AI patient's side of the call: Claude Haiku 5.5, thinking off and low
// effort for fast spoken replies. Cost guardrails:
//   - the system prompt (persona + office rules) is the same every turn and is
//     cached (cache_control), so later turns pay ~5% for it;
//   - only the last few turns are sent verbatim; older ones are folded into a
//     short rolling summary (practice_calls.persona_summary).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Persona } from "./personas";
import type { CallContext } from "./rules";
import { ROLEPLAY_TITLES, type CallType, type Roleplay, type TranscriptEntry } from "./types";

const MODEL = "claude-haiku-5-5";

// Verbatim window and when to fold older turns into the summary.
const KEEP_RECENT = 8;
const FOLD_AT = 14;

const ReplySchema = z.object({
  say: z.string().describe("What the patient says next, spoken aloud: 1-2 short sentences, no stage directions"),
  end_call: z.boolean().describe("true only when the call is clearly over (goodbyes said, or you've decided to hang up)"),
});
export type PatientReply = z.infer<typeof ReplySchema>;

export type TurnUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function patientSystemPrompt(input: {
  ctx: CallContext;
  persona: Persona;
  callType: CallType;
  targetTurns: number;
}): string {
  const { ctx, persona, callType } = input;
  const outbound = persona.roleplay?.title === "confirmation";
  const facts = Object.entries(ctx.scripts)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const cadence = ctx.cadence
    .map((c) => `- ${c.label}${c.callUse === "defer" ? " (do not push for this on the phone)" : ""}: ${c.value}`)
    .join("\n");
  const roleplay = persona.roleplay
    ? `\nThis is a required roleplay: ${ROLEPLAY_TITLES[persona.roleplay.title as Roleplay] ?? persona.roleplay.title}.\n${persona.roleplay.brief}${
        persona.roleplay.scenario ? `\nSituation to play: ${persona.roleplay.scenario}` : ""
      }\n`
    : "";

  return `You are role-playing a patient on a phone call with a chiropractic office, so a virtual assistant (VA) can practice. The VA is a trainee. Stay in character the whole call.

You are ${persona.firstName} ${persona.lastName}, ${persona.age}. Phone ${persona.phone}. ${outbound ? "The office is calling you." : `You're calling because of ${persona.reason}. You heard about the office because ${persona.referral}.`} Insurance: ${persona.insurance}.
How you talk: ${persona.style}
${roleplay}
Things to bring up during the call, naturally and one at a time (don't rush them all at once):
${persona.asks.length ? persona.asks.map((a) => `- ${a}`).join("\n") : "- Nothing special; let the VA lead."}

Office: ${ctx.officeName}${ctx.doctorName ? `, ${ctx.doctorName}` : ""}.
The office's own rules and scripts are below so you know what to test. You are a patient: you DON'T know these rules, never quote them, and never coach the VA.
${facts || "- (no phone scripts on file)"}
Scheduling cadence:
${cadence}

Care plans are normally explained at the office visit, not on the phone. Don't push for a care plan; if the VA offers to go over it at the visit, accept that.

Rules for every reply:
- Speak like a real caller: 1-2 short sentences, plain spoken words, no lists, no stage directions, no emojis.
- React to what the VA actually said. If they ask for your details, give the fictional ones above.
- Never ask for or give real personal information. If the VA asks something you don't have (like a birthday), make one up that's clearly fictional.
- ${callType === "easy" || callType === "w2d1_roleplay" ? "Be cooperative and book when offered a reasonable time." : "Make the VA work for it, but agree to book if they handle your concerns well."}
- The VA leads the call and decides when it ends. Never end it yourself: if the VA asks "anything else?", answer, but stay on the line.
- Set end_call to true only after the VA says goodbye (or clearly closes the call): then say a short goodbye.
- A typical call is about ${input.targetTurns} of your replies, but keep going as long as the VA is still working on it.`;
}

function toMessages(summary: string | null, recent: TranscriptEntry[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = recent.map((t) => ({
    role: t.speaker === "va" ? "user" : "assistant",
    content: t.text,
  }));
  if (summary && messages[0]?.role === "user") {
    messages[0] = { role: "user", content: `(Earlier in this call: ${summary})\n\n${messages[0].content as string}` };
  }
  return messages;
}

// The verbatim window must start with the VA (a user turn).
export function windowStart(transcript: TranscriptEntry[], summarizedCount: number) {
  let start = Math.max(summarizedCount, transcript.length - KEEP_RECENT);
  while (start < transcript.length && transcript[start].speaker !== "va") start++;
  return start;
}

export const needsFold = (transcript: TranscriptEntry[], summarizedCount: number) =>
  transcript.length - summarizedCount > FOLD_AT;

const usageOf = (u: Anthropic.Usage): TurnUsage => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
});

export async function patientReply(input: {
  system: string;
  summary: string | null;
  recent: TranscriptEntry[];
}): Promise<{ reply: PatientReply; usage: TurnUsage }> {
  const client = new Anthropic();
  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: 400,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: zodOutputFormat(ReplySchema) },
    system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
    messages: toMessages(input.summary, input.recent),
  });
  if (message.stop_reason === "refusal") {
    // Haiku has no server-side fallback: keep the call going with a neutral line.
    return { reply: { say: "Sorry, could you say that again?", end_call: false }, usage: usageOf(message.usage) };
  }
  if (!message.parsed_output) throw new Error("The patient's reply couldn't be read.");
  const say = message.parsed_output.say.trim().slice(0, 600) || "Sorry, could you repeat that?";
  return { reply: { say, end_call: message.parsed_output.end_call }, usage: usageOf(message.usage) };
}

// Fold older turns into the running summary (2-4 sentences).
export async function foldSummary(previous: string | null, turns: TranscriptEntry[]): Promise<{ summary: string; usage: TurnUsage }> {
  const client = new Anthropic();
  const lines = turns.map((t) => `${t.speaker === "va" ? "VA" : "Patient"}: ${t.text}`).join("\n");
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system:
      "Summarize a practice phone call between a chiropractic office VA and a patient in 2-4 plain sentences: what the patient wants, what's been agreed or booked, details already given, and questions still open. No commentary.",
    messages: [{ role: "user", content: `${previous ? `Summary so far: ${previous}\n\n` : ""}Next part of the call:\n${lines}` }],
  });
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
  return { summary: text.slice(0, 1500) || previous || "", usage: usageOf(message.usage) };
}

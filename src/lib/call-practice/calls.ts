import "server-only";

// Starting a call, each VA turn, and abandoning a call. Every write uses the
// service role after checking the signed-in VA owns the call; the browser
// never writes practice_calls directly (no RLS insert/update for VAs).

import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ACCESS_MESSAGES, callAccess, callsStartedToday } from "./access";
import { makePersona, roleplayScenario, targetTurns, turnLimit, type Persona } from "./personas";
import { foldSummary, needsFold, patientReply, patientSystemPrompt, windowStart, type TurnUsage } from "./patient";
import { cadenceSources, loadCallContext } from "./rules";
import { CALL_TYPES, isRoleplayFor, type CallType, type PublicPersona, type Roleplay, type TranscriptEntry } from "./types";

type Db = ReturnType<typeof createAdminClient>;

// A call left open this long is abandoned when the VA starts another.
const STALE_MINUTES = 30;
const MAX_VA_CHARS = 1000;

export type StoredPersona = Persona & { prompt: string; scenarioCode?: string };

export type CallRow = {
  id: string;
  va_id: string;
  office_id: string;
  call_type: CallType;
  roleplay: Roleplay | null;
  persona: StoredPersona;
  persona_summary: string | null;
  summarized_count: number;
  transcript: TranscriptEntry[];
  patient_turns: number;
  status: "in_progress" | "finished" | "abandoned";
  usage: Usage;
  started_at: string;
};

export type Usage = {
  haikuInput?: number;
  haikuOutput?: number;
  haikuCacheRead?: number;
  haikuCacheWrite?: number;
  opusInput?: number;
  opusOutput?: number;
  ttsChars?: number;
};

export type Fail = { error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ error, status });

const CALL_COLUMNS =
  "id, va_id, office_id, call_type, roleplay, persona, persona_summary, summarized_count, transcript, patient_turns, status, usage, started_at";

function addUsage(u: Usage, t: TurnUsage): Usage {
  return {
    ...u,
    haikuInput: (u.haikuInput ?? 0) + t.input,
    haikuOutput: (u.haikuOutput ?? 0) + t.output,
    haikuCacheRead: (u.haikuCacheRead ?? 0) + t.cacheRead,
    haikuCacheWrite: (u.haikuCacheWrite ?? 0) + t.cacheWrite,
  };
}

const now = () => new Date().toISOString();
export const publicPersona = (p: Persona): PublicPersona => ({ firstName: p.firstName, voice: p.voice });

export async function loadOwnCall(user: CurrentUser, id: string, db: Db = createAdminClient()): Promise<CallRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from("practice_calls").select(CALL_COLUMNS).eq("id", id).maybeSingle();
  const row = data as CallRow | null;
  return row && row.va_id === user.id ? row : null;
}

export async function startCall(
  user: CurrentUser,
  input: { callType: unknown; roleplay: unknown },
): Promise<{ id: string; persona: PublicPersona; opening: TranscriptEntry | null; left: number } | Fail> {
  const callType = CALL_TYPES.find((t) => t === input.callType);
  if (!callType) return fail("Pick a call type.");
  const roleplay = isRoleplayFor(callType, input.roleplay as string) ? (input.roleplay as Roleplay) : null;
  if ((callType === "w2d1_roleplay" || callType === "w2d2_roleplay") && !roleplay) return fail("Pick which roleplay.");

  const db = createAdminClient();
  const access = await callAccess(user, db);
  if (!access.allowed) return fail(ACCESS_MESSAGES[access.reason], 403);

  const used = await callsStartedToday(user.id, access.timeZone, db);
  if (used >= access.settings.dailyCap) {
    return fail(`You've used all ${access.settings.dailyCap} practice calls for today. You can practice again tomorrow.`, 429);
  }

  // One call at a time: close anything this VA left open.
  await db
    .from("practice_calls")
    .update({ status: "abandoned", finished_at: now() })
    .eq("va_id", user.id)
    .eq("status", "in_progress");

  const ctx = await loadCallContext(access.officeId, db);
  const scenario = roleplay ? await roleplayScenario(db, access.officeId, roleplay) : null;
  const persona = makePersona({ callType, roleplay, ctx, scenarioStem: scenario?.stem });
  const prompt = patientSystemPrompt({ ctx, persona, callType, targetTurns: targetTurns(callType) });
  const stored: StoredPersona = { ...persona, prompt, scenarioCode: scenario?.code };

  // In a confirmation call the VA phones the patient, who answers first.
  const opening: TranscriptEntry | null = roleplay === "confirmation" ? { speaker: "patient", text: "Hello?", at: now() } : null;

  const { data, error } = await db
    .from("practice_calls")
    .insert({
      va_id: user.id,
      office_id: access.officeId,
      call_type: callType,
      roleplay,
      persona: stored,
      transcript: opening ? [opening] : [],
      patient_turns: opening ? 1 : 0,
      cadence_sources: cadenceSources(ctx),
    })
    .select("id")
    .single();
  if (error || !data) return fail("The call couldn't be started. Try again.", 500);

  return { id: data.id as string, persona: publicPersona(persona), opening, left: access.settings.dailyCap - used - 1 };
}

export async function takeTurn(
  user: CurrentUser,
  id: string,
  rawText: unknown,
): Promise<{ say: string; endCall: boolean; index: number } | Fail> {
  const text = typeof rawText === "string" ? rawText.replace(/\s+/g, " ").trim().slice(0, MAX_VA_CHARS) : "";
  if (!text) return fail("We didn't catch that. Hold the button and speak again.");

  const db = createAdminClient();
  const call = await loadOwnCall(user, id, db);
  if (!call) return fail("Call not found.", 404);
  if (call.status !== "in_progress") return fail("This call has ended.", 409);
  if (Date.now() - new Date(call.started_at).getTime() > STALE_MINUTES * 60 * 1000) {
    await db.from("practice_calls").update({ status: "abandoned", finished_at: now() }).eq("id", id).eq("status", "in_progress");
    return fail("This call timed out. Start a new one.", 409);
  }

  const transcript: TranscriptEntry[] = [...call.transcript, { speaker: "va", text, at: now() }];
  let usage = call.usage ?? {};
  let summary = call.persona_summary;
  let summarized = call.summarized_count;

  if (needsFold(transcript, summarized)) {
    const start = windowStart(transcript, summarized);
    const folded = await foldSummary(summary, transcript.slice(summarized, start));
    summary = folded.summary;
    summarized = start;
    usage = addUsage(usage, folded.usage);
  }

  let say: string;
  let endCall: boolean;
  if (call.patient_turns >= turnLimit(call.call_type)) {
    // Past the turn limit: the patient wraps up politely.
    say = "Okay, I really have to go now. Thank you, bye!";
    endCall = true;
  } else {
    const result = await patientReply({
      system: call.persona.prompt,
      summary,
      recent: transcript.slice(windowStart(transcript, summarized)),
    });
    say = result.reply.say;
    endCall = result.reply.end_call;
    usage = addUsage(usage, result.usage);
  }
  transcript.push({ speaker: "patient", text: say, at: now() });

  // Optimistic check: a second request for the same turn can't double-write.
  const { data, error } = await db
    .from("practice_calls")
    .update({
      transcript,
      patient_turns: call.patient_turns + 1,
      persona_summary: summary,
      summarized_count: summarized,
      usage,
    })
    .eq("id", id)
    .eq("status", "in_progress")
    .eq("patient_turns", call.patient_turns)
    .select("id");
  if (error) return fail("The call couldn't be saved. Try again.", 500);
  if (!data?.length) return fail("That turn was already sent.", 409);

  return { say, endCall, index: transcript.length - 1 };
}

export async function abandonCall(user: CurrentUser, id: string): Promise<{ ok: true } | Fail> {
  const db = createAdminClient();
  const call = await loadOwnCall(user, id, db);
  if (!call) return fail("Call not found.", 404);
  if (call.status === "in_progress") {
    await db.from("practice_calls").update({ status: "abandoned", finished_at: now() }).eq("id", id).eq("status", "in_progress");
  }
  return { ok: true };
}

// The patient line to speak: only text already in this VA's own transcript,
// so the voice route can't be used to read out arbitrary text.
export async function patientLine(user: CurrentUser, id: string, index: number): Promise<{ text: string; voice: string } | Fail> {
  const call = await loadOwnCall(user, id);
  if (!call) return fail("Call not found.", 404);
  const entry = Number.isInteger(index) ? call.transcript[index] : undefined;
  if (!entry || entry.speaker !== "patient") return fail("Nothing to say.", 404);
  return { text: entry.text, voice: call.persona.voice };
}

import { after } from "next/server";
import { takeTurn } from "@/lib/call-practice/calls";
import { speech, SpeechError } from "@/lib/call-practice/tts";
import { failed, requireCaller } from "../../guard";

// One VA turn: { text } -> the patient's reply, spoken. To keep the call
// conversational it's one round trip: the reply text comes in headers
// (X-Patient-Say, URL-encoded; X-End-Call; X-Index) and the patient's voice
// streams in the body as mp3 while it's being made. If the voice fails, the
// reply comes back as JSON instead ({ say, endCall, index, voiceError }).
// Server-Timing shows where the time went.
export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/turn">) {
  const t0 = performance.now();
  const lap = (from: number) => Math.round(performance.now() - from);
  const user = await requireCaller();
  if (user instanceof Response) return user;
  const tAuth = lap(t0);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const t1 = performance.now();
  const turn = await takeTurn(user, id, body.text);
  if ("error" in turn) return failed(turn);
  const tReply = lap(t1);
  after(() => turn.background().catch((e: unknown) => console.error("Call summary fold failed:", e)));

  const t2 = performance.now();
  const [saveError, voice] = await Promise.all([
    turn.saved,
    speech(turn.say, turn.voice).catch((e: unknown) => (e instanceof SpeechError ? e : new SpeechError("The patient's voice couldn't be played.", 502))),
  ]);
  if (saveError) {
    if (!(voice instanceof SpeechError)) void voice.body?.cancel();
    return failed(saveError);
  }
  const timing = `auth;dur=${tAuth}, reply;dur=${tReply}, voice;dur=${lap(t2)}, total;dur=${lap(t0)}`;
  const meta = { say: turn.say, endCall: turn.endCall, index: turn.index };
  if (voice instanceof SpeechError) {
    return Response.json({ ...meta, voiceError: voice.message }, { headers: { "Server-Timing": timing } });
  }
  return new Response(voice.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      "X-Patient-Say": encodeURIComponent(turn.say),
      "X-End-Call": turn.endCall ? "1" : "0",
      "X-Index": String(turn.index),
      "Server-Timing": timing,
    },
  });
}

import "server-only";

// The patient's voice: OpenAI text-to-speech, server side only. The audio is
// streamed straight to the browser and never stored. OPENAI_API_KEY comes from
// Vercel; OPENAI_TTS_MODEL can override the model. Default gpt-4o-mini-tts:
// it starts streaming in about 0.5-1 s, against 1.2-2.5 s for tts-1
// (measured Nov 2026), and takes speaking instructions.

const VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"]);
const INSTRUCTIONS =
  "You are a patient on the phone with a chiropractic office. Speak naturally and conversationally, at a normal phone pace, like a real caller. No announcer voice.";
const MAX_CHARS = 600;

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function speech(text: string, voice: string): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new SpeechError("The patient's voice isn't set up yet (OPENAI_API_KEY is missing).", 503);
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice: VOICES.has(voice) ? voice : "nova",
      input: text.slice(0, MAX_CHARS),
      response_format: "mp3",
      ...(model.startsWith("tts-1") ? {} : { instructions: INSTRUCTIONS }),
    }),
  });
  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? detail;
    } catch {
      // not JSON
    }
    console.error("OpenAI speech failed:", detail);
    throw new SpeechError("The patient's voice couldn't be played. The words are still in the transcript.", 502);
  }
  return res;
}

// Characters sent to text-to-speech (for cost tracking).
export const speechChars = (text: string) => Math.min(text.length, MAX_CHARS);

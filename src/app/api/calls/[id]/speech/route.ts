import { patientLine } from "@/lib/call-practice/calls";
import { speech, SpeechError } from "@/lib/call-practice/tts";
import { failed, requireVa } from "../../guard";

// The patient's voice for transcript line ?i=<index>, streamed as mp3.
// Nothing is stored: the audio goes straight from OpenAI to the browser.
export async function GET(request: Request, ctx: RouteContext<"/api/calls/[id]/speech">) {
  const user = await requireVa();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const index = Number(new URL(request.url).searchParams.get("i"));
  const line = await patientLine(user, id, index);
  if ("error" in line) return failed(line);
  try {
    const audio = await speech(line.text, line.voice);
    return new Response(audio.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof SpeechError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

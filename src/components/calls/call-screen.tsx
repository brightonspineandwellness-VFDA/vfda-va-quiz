"use client";

// The call screen: the AI patient speaks (OpenAI voice, streamed, never
// saved), the VA holds the button and talks (the browser's Web Speech API,
// Chrome / Edge only), and the transcript runs live. Every turn goes through
// the server (/api/calls/...); no key or model call is in the browser.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import type { CallType, PublicPersona, Roleplay, TranscriptEntry } from "@/lib/call-practice/types";

type Phase = "check" | "unsupported" | "mic" | "mic_blocked" | "ready" | "starting" | "listening" | "thinking" | "speaking" | "idle" | "ending" | "error";

// Minimal Web Speech API typing (not in the DOM lib).
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Chrome or Edge on a computer or Android. Not Firefox, Safari, Opera or iOS browsers.
function isChromeOrEdge() {
  const ua = navigator.userAgent;
  if (/OPR\/|Firefox\/|FxiOS|CriOS|EdgiOS/.test(ua)) return false;
  return /Chrome\/|Edg\//.test(ua) && !!recognitionCtor();
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

export function CallScreen({ callType, roleplay, title }: { callType: CallType; roleplay: Roleplay | null; title: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("check");
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [persona, setPersona] = useState<PublicPersona | null>(null);
  const [lines, setLines] = useState<Pick<TranscriptEntry, "speaker" | "text">[]>([]);
  const [interim, setInterim] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  const recRef = useRef<Recognition | null>(null);
  const heardRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Browser check runs once, on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase(isChromeOrEdge() ? "mic" : "unsupported");
  }, []);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [lines, interim]);

  const live = callId !== null && !["ending", "error"].includes(phase);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  // Leaving mid-call closes it without feedback (still counts toward today's cap).
  useEffect(() => {
    const leave = () => {
      if (callIdRef.current && !finishedRef.current) navigator.sendBeacon(`/api/calls/${callIdRef.current}/abandon`);
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  async function askForMic() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPhase("ready");
    } catch {
      setPhase("mic_blocked");
    }
  }

  const finish = useCallback(async () => {
    const id = callIdRef.current;
    if (!id || finishedRef.current) return;
    finishedRef.current = true;
    recRef.current?.abort();
    audioRef.current?.pause();
    setPhase("ending");
    try {
      await post(`/api/calls/${id}/finish`);
      router.push(`/va/calls/${id}`);
    } catch (e) {
      finishedRef.current = false;
      setError(e instanceof Error ? e.message : "The feedback couldn't be made. Try again.");
      setPhase("idle");
    }
  }, [router]);

  const speak = useCallback(
    async (index: number, endCall: boolean) => {
      const id = callIdRef.current;
      if (!id) return;
      setPhase("speaking");
      const audio = new Audio(`/api/calls/${id}/speech?i=${index}`);
      audioRef.current = audio;
      const done = () => {
        if (endCall) void finish();
        else setPhase("idle");
      };
      audio.onended = done;
      audio.onerror = () => {
        setError("The patient's voice didn't play. Read their words in the transcript and keep going.");
        done();
      };
      try {
        await audio.play();
      } catch {
        done();
      }
    },
    [finish],
  );

  async function startCall() {
    setError(null);
    setPhase("starting");
    try {
      const res = await post<{ id: string; persona: PublicPersona; opening: TranscriptEntry | null; left: number }>("/api/calls", {
        callType,
        roleplay,
      });
      callIdRef.current = res.id;
      setCallId(res.id);
      setPersona(res.persona);
      setLeft(res.left);
      if (res.opening) {
        setLines([{ speaker: "patient", text: res.opening.text }]);
        await speak(0, false);
      } else {
        setPhase("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The call couldn't be started.");
      setPhase("ready");
    }
  }

  async function sendTurn(text: string) {
    const id = callIdRef.current;
    if (!id) return;
    setLines((l) => [...l, { speaker: "va", text }]);
    setPhase("thinking");
    try {
      const res = await post<{ say: string; endCall: boolean; index: number }>(`/api/calls/${id}/turn`, { text });
      setLines((l) => [...l, { speaker: "patient", text: res.say }]);
      await speak(res.index, res.endCall);
    } catch (e) {
      setLines((l) => l.slice(0, -1));
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      setPhase("idle");
    }
  }

  function startTalking() {
    if (phase !== "idle") return;
    const Ctor = recognitionCtor();
    if (!Ctor) return setPhase("unsupported");
    setError(null);
    heardRef.current = "";
    setInterim("");
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      heardRef.current = finalText;
      setInterim((finalText + " " + interimText).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setPhase("mic_blocked");
    };
    rec.onend = () => {
      const said = (heardRef.current || "").trim() || interimRef.current.trim();
      recRef.current = null;
      setInterim("");
      if (said) void sendTurn(said);
      else {
        setError("We didn't hear anything. Hold the button while you speak, then let go.");
        setPhase("idle");
      }
    };
    recRef.current = rec;
    rec.start();
    setPhase("listening");
  }

  // Latest interim text, for a release before Chrome marks it final.
  const interimRef = useRef("");
  useEffect(() => {
    interimRef.current = interim;
  }, [interim]);

  function stopTalking() {
    if (phase === "listening") recRef.current?.stop();
  }

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (phase === "check") return null;

  if (phase === "unsupported") {
    return (
      <Notice tone="warning" title="Please use Chrome" role="alert">
        <p>Call practice needs Google Chrome (or Microsoft Edge) on a computer, because it uses Chrome&apos;s speech recognition.</p>
        <p>Open this page in Chrome and try again.</p>
      </Notice>
    );
  }

  if (phase === "mic" || phase === "mic_blocked") {
    return (
      <Card title="Before you start">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Use a headset with a microphone. With speakers, the patient&apos;s voice can echo back into your mic.</li>
          <li>Find a quiet place. You&apos;ll hold a button while you talk, then let go.</li>
          <li>Never use real patient names, birthdays or phone numbers. The patient is made up.</li>
        </ul>
        {phase === "mic_blocked" && (
          <Notice tone="warning" title="Your microphone is blocked" role="alert">
            <p>Click the lock or settings icon to the left of the address bar, set Microphone to Allow, then reload this page.</p>
            <p>If you have more than one microphone, check that your headset is the one selected.</p>
          </Notice>
        )}
        <div>
          <Button variant="primary" onClick={askForMic}>
            Allow microphone
          </Button>
        </div>
      </Card>
    );
  }

  const status: Record<Phase, string> = {
    check: "",
    unsupported: "",
    mic: "",
    mic_blocked: "",
    ready: "Ready when you are.",
    starting: "Connecting…",
    listening: "Listening… let go when you're done.",
    thinking: `${persona?.firstName ?? "The patient"} is thinking…`,
    speaking: `${persona?.firstName ?? "The patient"} is talking…`,
    idle: lines.length ? "Your turn. Hold the button and speak." : "The phone is ringing. Answer with the office greeting.",
    ending: "Ending the call and writing your feedback…",
    error: "",
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card title={title} description={persona ? `Caller: ${persona.firstName} (AI patient)` : undefined} actions={live ? <span className="tabular-nums text-muted">{time}</span> : undefined}>
        <Notice tone="warning" role="note">
          Never use real patient names, birthdays or phone numbers.
        </Notice>
        <div ref={boxRef} className="flex max-h-[26rem] min-h-48 flex-col gap-2 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface-muted p-3" aria-live="polite">
          {!lines.length && !interim && <p className="text-muted">The transcript shows here as you talk.</p>}
          {lines.map((l, i) => (
            <p key={i} className={l.speaker === "va" ? "max-w-[85%] self-end rounded-lg bg-primary-soft px-3 py-2" : "max-w-[85%] self-start rounded-lg bg-surface px-3 py-2"}>
              <span className="block text-xs font-semibold text-muted">{l.speaker === "va" ? "You" : (persona?.firstName ?? "Patient")}</span>
              {l.text}
            </p>
          ))}
          {interim && (
            <p className="max-w-[85%] self-end rounded-lg border border-dashed border-line-strong px-3 py-2 text-muted">{interim}</p>
          )}
        </div>
        <p className="text-sm font-medium" role="status">
          {status[phase]}
        </p>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {!callId ? (
            <Button variant="primary" onClick={startCall} disabled={phase === "starting"}>
              Start call
            </Button>
          ) : (
            <>
              <Button
                variant={phase === "listening" ? "danger" : "primary"}
                disabled={!["idle", "listening"].includes(phase)}
                aria-pressed={phase === "listening"}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  startTalking();
                }}
                onPointerUp={stopTalking}
                onPointerCancel={stopTalking}
                onKeyDown={(e) => {
                  if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                    e.preventDefault();
                    startTalking();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") stopTalking();
                }}
                className="min-w-44 select-none touch-none"
              >
                {phase === "listening" ? "Listening… let go to send" : "Hold to talk"}
              </Button>
              <Button variant="secondary" onClick={finish} disabled={phase === "ending" || lines.length < 2}>
                End call and get feedback
              </Button>
            </>
          )}
        </div>
      </Card>
      <Card title="Tips">
        <ul className="list-disc space-y-1.5 pl-5 text-[0.9375rem]">
          <li>Answer with your office&apos;s greeting.</li>
          <li>Speak, then let go of the button. The patient answers out loud.</li>
          <li>Book the way your office books. Care plans are explained at the visit.</li>
          <li>Say goodbye to end the call, or press End call.</li>
        </ul>
        {left !== null && <p className="text-sm text-muted">{left} practice calls left today.</p>}
      </Card>
    </div>
  );
}

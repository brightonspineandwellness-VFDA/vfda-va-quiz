"use client";

// The call screen: the AI patient speaks (OpenAI voice, streamed, never
// saved), the VA holds the button and talks (the browser's Web Speech API,
// Chrome / Edge only), and the transcript runs live. Every turn goes through
// the server (/api/calls/...); no key or model call is in the browser.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import type { CallType, PublicPersona, Roleplay, TranscriptEntry } from "@/lib/call-practice/types";

type Phase = "check" | "unsupported" | "mic" | "mic_blocked" | "ready" | "starting" | "listening" | "thinking" | "speaking" | "idle" | "ending" | "error";

// "Ring ring ring": three short phone rings (the US ring tone, 440 + 480 Hz),
// made in the browser, about 3.5 seconds. Started from the Start call click,
// so the browser allows the sound.
function playRings(count = 3): Promise<void> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return Promise.resolve();
  const ctx = new Ctx();
  const ring = 0.9;
  const gap = 0.35;
  const out = ctx.createGain();
  out.gain.value = 0.12;
  out.connect(ctx.destination);
  for (let i = 0; i < count; i++) {
    const start = ctx.currentTime + 0.05 + i * (ring + gap);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(1, start + 0.03);
    env.gain.setValueAtTime(1, start + ring - 0.05);
    env.gain.linearRampToValueAtTime(0, start + ring);
    env.connect(out);
    for (const f of [440, 480]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(env);
      o.start(start);
      o.stop(start + ring);
    }
  }
  const total = (0.05 + count * (ring + gap)) * 1000;
  return new Promise((resolve) =>
    setTimeout(() => {
      void ctx.close();
      resolve();
    }, total),
  );
}

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

// Plays an mp3 response while it downloads (Media Source Extensions), so the
// patient starts talking as soon as the first audio arrives. Falls back to
// playing the whole clip when the browser can't stream it. Resolves when the
// patient stops talking: true if it played.
async function playStream(res: Response, audioRef: { current: HTMLAudioElement | null }): Promise<boolean> {
  const audio = new Audio();
  audioRef.current = audio;
  const finished = new Promise<boolean>((resolve) => {
    audio.onended = () => resolve(true);
    audio.onerror = () => resolve(false);
    audio.onpause = () => {
      if (audioRef.current !== audio) resolve(true); // the screen was closed
    };
  });
  try {
    const canStream = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg") && res.body;
    if (!canStream) {
      const blob = await res.blob();
      audio.src = URL.createObjectURL(blob);
      await audio.play();
      return finished;
    }
    const ms = new MediaSource();
    audio.src = URL.createObjectURL(ms);
    await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));
    const sb = ms.addSourceBuffer("audio/mpeg");
    const reader = res.body!.getReader();
    let started = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise((r) => {
        sb.addEventListener("updateend", r, { once: true });
        sb.appendBuffer(value);
      });
      if (!started) {
        started = true;
        audio.play().catch(() => {});
      }
    }
    if (ms.readyState === "open") ms.endOfStream();
    if (!started) return false;
    return finished;
  } catch {
    return false;
  }
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

  // Browser and microphone check, each time the screen is shown. When the
  // microphone is already allowed, go straight to "Start call".
  useEffect(() => {
    let live = true;
    if (!isChromeOrEdge()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("unsupported");
      return;
    }
    setPhase("mic");
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((p) => {
        if (live && p.state === "granted") setPhase((ph) => (ph === "mic" ? "ready" : ph));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Next.js keeps a page alive (hidden) when you navigate away and shows it
  // again when you come back. Leaving the call screen ends any open call and
  // clears it, so the next visit starts a fresh call.
  useLayoutEffect(() => {
    return () => {
      recRef.current?.abort();
      recRef.current = null;
      audioRef.current?.pause();
      audioRef.current = null;
      if (callIdRef.current && !finishedRef.current) navigator.sendBeacon(`/api/calls/${callIdRef.current}/abandon`);
      callIdRef.current = null;
      finishedRef.current = false;
      heardRef.current = "";
      setCallId(null);
      setPersona(null);
      setLines([]);
      setInterim("");
      setError(null);
      setLeft(null);
      setSeconds(0);
      setPhase("check");
    };
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
      // The phone rings while the call is set up.
      const [res] = await Promise.all([
        post<{ id: string; persona: PublicPersona; opening: TranscriptEntry | null; left: number }>("/api/calls", {
          callType,
          roleplay,
        }),
        playRings(3).catch(() => {}),
      ]);
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

  // One round trip per turn: the reply text arrives in headers and the
  // patient's voice streams in the body, playing while it's still arriving.
  async function sendTurn(text: string) {
    const id = callIdRef.current;
    if (!id) return;
    setLines((l) => [...l, { speaker: "va", text }]);
    setPhase("thinking");
    try {
      const res = await fetch(`/api/calls/${id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "That didn't go through. Try again.");
      }
      if ((res.headers.get("content-type") ?? "").includes("audio")) {
        const say = decodeURIComponent(res.headers.get("x-patient-say") ?? "");
        const endCall = res.headers.get("x-end-call") === "1";
        setLines((l) => [...l, { speaker: "patient", text: say }]);
        setPhase("speaking");
        const played = await playStream(res, audioRef);
        if (!played) setError("The patient's voice didn't play. Read their words in the transcript and keep going.");
        if (endCall) void finish();
        else setPhase("idle");
      } else {
        const data = (await res.json()) as { say: string; endCall: boolean; voiceError?: string };
        setLines((l) => [...l, { speaker: "patient", text: data.say }]);
        if (data.voiceError) setError(`${data.voiceError} Read their words in the transcript and keep going.`);
        if (data.endCall) void finish();
        else setPhase("idle");
      }
    } catch (e) {
      setLines((l) => l.slice(0, -1));
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      setPhase("idle");
    }
  }

  // What Chrome has heard so far (final + in-progress words).
  const liveRef = useRef("");
  const sentRef = useRef(false);

  function startTalking() {
    if (phase !== "idle") return;
    const Ctor = recognitionCtor();
    if (!Ctor) return setPhase("unsupported");
    setError(null);
    heardRef.current = "";
    liveRef.current = "";
    sentRef.current = false;
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
      liveRef.current = (finalText + " " + interimText).replace(/\s+/g, " ").trim();
      setInterim(liveRef.current);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setPhase("mic_blocked");
    };
    // Chrome stopped listening on its own (a long pause or a network blip)
    // while the button was still held: send what it heard.
    rec.onend = () => {
      recRef.current = null;
      if (!sentRef.current) sendHeard();
    };
    recRef.current = rec;
    rec.start();
    setPhase("listening");
  }

  function sendHeard() {
    if (sentRef.current) return;
    sentRef.current = true;
    const said = liveRef.current.trim();
    setInterim("");
    if (said) void sendTurn(said);
    else {
      setError("We didn't hear anything. Hold the button while you speak, then let go.");
      setPhase("idle");
    }
  }

  // Letting go sends right away, without waiting for Chrome to finish
  // processing: a short pause catches the last word, then listening stops.
  function stopTalking() {
    if (phase !== "listening" || sentRef.current) return;
    setPhase("thinking");
    setTimeout(() => {
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.onend = null;
        rec.abort();
      }
      sendHeard();
    }, 250);
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
    starting: roleplay === "confirmation" ? "Calling the patient… ring, ring, ring" : "Ring, ring, ring… the phone is ringing",
    listening: "Listening… let go when you're done.",
    thinking: `${persona?.firstName ?? "The patient"} is thinking…`,
    speaking: `${persona?.firstName ?? "The patient"} is talking…`,
    idle: lines.length ? "Your turn. Hold the button and speak." : "You've picked up. Answer with your office greeting.",
    ending: "The call has ended. Writing your feedback (about 20 seconds)…",
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

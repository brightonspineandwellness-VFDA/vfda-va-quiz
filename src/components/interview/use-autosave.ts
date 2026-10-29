"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Job = () => Promise<{ ok: boolean; error?: string }>;
export type SaveState = { status: "saving" | "saved" | "error"; error?: string };

// Saves each field after a short pause. Saves for the same field run one at a
// time, in order, and only the latest value is sent.
export function useAutosave() {
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queued = useRef(new Map<string, Job>());
  const lastJob = useRef(new Map<string, Job>());
  const chains = useRef(new Map<string, Promise<void>>());

  const setState = (id: string, state: SaveState | null) =>
    setStates((s) => {
      const next = { ...s };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });

  const flush = useCallback((id: string) => {
    timers.current.delete(id);
    const job = queued.current.get(id);
    if (!job) return;
    queued.current.delete(id);
    const chain = (chains.current.get(id) ?? Promise.resolve()).then(async () => {
      const result = await job().catch(() => ({ ok: false, error: "Couldn't reach the server." }));
      if (queued.current.has(id)) return; // a newer value is on its way
      setState(id, result.ok ? { status: "saved" } : { status: "error", error: result.error });
    });
    chains.current.set(id, chain);
  }, []);

  const save = useCallback(
    (id: string, job: Job, delayMs = 800) => {
      clearTimeout(timers.current.get(id));
      queued.current.set(id, job);
      lastJob.current.set(id, job);
      setState(id, { status: "saving" });
      timers.current.set(id, setTimeout(() => flush(id), delayMs));
    },
    [flush],
  );

  const retry = useCallback(
    (id: string) => {
      const job = lastJob.current.get(id);
      if (job) save(id, job, 0);
    },
    [save],
  );

  // Drop a pending save, e.g. for a card that was just removed.
  const cancel = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    queued.current.delete(id);
    setState(id, null);
  }, []);

  const values = Object.values(states);
  const saving = values.some((s) => s.status === "saving");
  const failed = values.filter((s) => s.status === "error").length;

  useEffect(() => {
    if (!saving) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  return { states, save, retry, cancel, saving, failed };
}

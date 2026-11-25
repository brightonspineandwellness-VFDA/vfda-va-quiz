"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { saveCallSettings, setCallPracticeOffice } from "@/lib/call-practice/admin-actions";
import type { CallPracticeSettings } from "@/lib/call-practice/access";

// VFDA: the global switch, the daily cap, who gets Call practice, and which
// offices have it while it isn't on for every office.
export function CallSettings({ settings, offices }: { settings: CallPracticeSettings; offices: { id: string; name: string; on: boolean }[] }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const r = await saveCallSettings(s);
      if (!r.ok) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });

  const toggleOffice = (id: string, on: boolean) =>
    start(async () => {
      setError(null);
      const r = await setCallPracticeOffice(id, on);
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  return (
    <Card title="Settings">
      <label className="inline-flex items-center gap-2" htmlFor="cp-enabled">
        <input id="cp-enabled" type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        <span>
          <span className="font-medium">Call practice is on</span> <span className="text-muted">(turn off to hide it for everyone)</span>
        </span>
      </label>
      <label className="inline-flex items-center gap-2" htmlFor="cp-all">
        <input id="cp-all" type="checkbox" checked={s.allOffices} onChange={(e) => setS({ ...s, allOffices: e.target.checked })} />
        <span>
          <span className="font-medium">Every office</span> <span className="text-muted">(off: only the offices ticked below)</span>
        </span>
      </label>
      <label className="inline-flex items-center gap-2" htmlFor="cp-phones">
        <input id="cp-phones" type="checkbox" checked={s.requirePhonesRole} onChange={(e) => setS({ ...s, requirePhonesRole: e.target.checked })} />
        <span>
          <span className="font-medium">Only VAs whose role includes Phones</span>
        </span>
      </label>
      <label className="flex flex-wrap items-center gap-2" htmlFor="cp-cap">
        <span className="font-medium">Calls per VA per day</span>
        <input id="cp-cap" type="number" min={1} max={100} className="w-24" value={s.dailyCap} onChange={(e) => setS({ ...s, dailyCap: Number(e.target.value) })} />
      </label>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {saved && <span className="text-success" role="status">Saved</span>}
      </div>
      {!settings.allOffices && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="font-medium">Offices with Call practice</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {offices.map((o) => (
              <li key={o.id}>
                <label className="inline-flex items-center gap-2" htmlFor={`cp-office-${o.id}`}>
                  <input id={`cp-office-${o.id}`} type="checkbox" checked={o.on} disabled={pending} onChange={(e) => toggleOffice(o.id, e.target.checked)} />
                  {o.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

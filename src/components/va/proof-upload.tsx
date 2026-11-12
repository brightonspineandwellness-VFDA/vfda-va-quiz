"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { buttonClass, Notice } from "@/components/ui";
import { MAX_UPLOAD_BYTES } from "@/lib/interview";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { addProof } from "@/lib/va-actions";

const BUCKET = "proof-of-work";

export function ProofWarning() {
  return (
    <Notice tone="danger" title="Fake patients only" role="note">
      <p>
        Screenshots and recordings must show made-up patients only. Never show real patient details, logins,
        passwords or card numbers. Crop or blur anything else that&apos;s private.
      </p>
    </Notice>
  );
}

// Upload a file (straight to the VA's own private folder) or paste a link.
export function ProofUpload({ officeId, vaId, day }: { officeId: string; vaId: string; day: string }) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setBusy(true);
    const supabase = createBrowserSupabase();
    for (const file of Array.from(list)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is over 50 MB. Upload it to Loom or Drive and paste the link instead.`);
        continue;
      }
      const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${officeId}/${vaId}/${day}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
      });
      if (uploadError) {
        setError(`${file.name}: ${uploadError.message}`);
        continue;
      }
      const result = await addProof(day, { path, name: file.name });
      if (!result.ok) setError(`${file.name}: ${result.error}`);
    }
    setBusy(false);
    router.refresh();
  }

  async function saveLink() {
    setError(null);
    setBusy(true);
    const result = await addProof(day, { link });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setLink("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className={buttonClass("secondary", "md", `cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`)}
        >
          {busy ? "Saving…" : "Upload a file"}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*,application/pdf,text/plain,video/mp4,video/quicktime,video/webm"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="text-sm text-muted">or</span>
        <form
          className="flex min-w-0 flex-1 flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) void saveLink();
          }}
        >
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.loom.com/share/…"
            aria-label="Link to your proof of work"
            className="min-w-0 flex-1 basis-56"
          />
          <button
            type="submit"
            disabled={busy || !link.trim()}
            className={buttonClass("secondary")}
          >
            Add link
          </button>
        </form>
      </div>
      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

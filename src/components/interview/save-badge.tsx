import type { SaveState } from "./use-autosave";

export function SaveBadge({ state, onRetry }: { state?: SaveState; onRetry: () => void }) {
  if (!state) return null;
  if (state.status === "saving") return <span className="text-xs text-muted">Saving…</span>;
  if (state.status === "saved") return <span className="text-xs font-medium text-success">Saved ✓</span>;
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-danger" role="alert">
      {state.error ?? "Not saved"}
      <button type="button" onClick={onRetry} className="underline hover:no-underline">
        Retry
      </button>
    </span>
  );
}

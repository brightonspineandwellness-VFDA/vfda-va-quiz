import type { SaveState } from "./use-autosave";

export function SaveBadge({ state, onRetry }: { state?: SaveState; onRetry: () => void }) {
  if (!state) return null;
  if (state.status === "saving") return <span className="text-xs text-foreground/50">Saving…</span>;
  if (state.status === "saved") return <span className="text-xs text-green-700 dark:text-green-400">Saved</span>;
  return (
    <span className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
      {state.error ?? "Not saved"}
      <button type="button" onClick={onRetry} className="underline">
        Retry
      </button>
    </span>
  );
}

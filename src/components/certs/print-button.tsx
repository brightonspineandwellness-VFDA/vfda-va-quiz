"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
    >
      Print
    </button>
  );
}

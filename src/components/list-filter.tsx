"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Search-as-you-type and quick filters for a server-rendered list, without
// reloading. Items are the elements inside #<scope> with data-filter-text
// (what the search box matches: names, emails, office, doctors),
// data-filter-tags (space-separated keys for the chips) and data-filter-key
// (one key per person or office, when it shows in several places). Items
// that don't match get the `hidden` attribute. The search text and chip live
// in the page URL (?q=...&f=...), so a refresh keeps them.
//
// `openOnHash`: a link to "#<id>" opens the <details> with that id (or inside
// it) and scrolls to it, e.g. a VA's collapsed section.

export function ListFilter({
  scope,
  placeholder,
  chips = [],
  openOnHash = false,
  label = "Search",
}: {
  scope: string;
  placeholder: string;
  chips?: { key: string; label: string }[];
  openOnHash?: boolean;
  label?: string;
}) {
  const params = useSearchParams();
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [chip, setChip] = useState<string | null>(() => {
    const f = params.get("f");
    return f && chips.some((c) => c.key === f) ? f : null;
  });
  const bar = useRef<HTMLDivElement>(null);

  // Show and hide the items, write the counts, and keep the URL in step.
  useLayoutEffect(() => {
    const root = document.getElementById(scope);
    if (!root || !bar.current) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-filter-text]")];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const byChip: Record<string, Set<string>> = {};
    const all = new Set<string>();
    const shown = new Set<string>();
    items.forEach((el, n) => {
      const text = (el.dataset.filterText ?? "").toLowerCase();
      const tags = (el.dataset.filterTags ?? "").split(/\s+/).filter(Boolean);
      const key = el.dataset.filterKey ?? String(n);
      const textOk = words.every((w) => text.includes(w));
      const show = textOk && (!chip || tags.includes(chip));
      el.hidden = !show;
      all.add(key);
      if (show) shown.add(key);
      if (textOk) for (const t of tags) (byChip[t] ??= new Set()).add(key);
    });
    for (const span of bar.current.querySelectorAll<HTMLElement>("[data-chip-count]")) {
      span.textContent = String(byChip[span.dataset.chipCount ?? ""]?.size ?? 0);
    }
    const summary = bar.current.querySelector<HTMLElement>("[data-filter-summary]");
    if (summary) summary.textContent = q.trim() || chip ? `Showing ${shown.size} of ${all.size}` : `${all.size} in all`;

    const url = new URL(window.location.href);
    if (q.trim()) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (chip) url.searchParams.set("f", chip);
    else url.searchParams.delete("f");
    window.history.replaceState(window.history.state, "", url);
  }, [scope, q, chip]);

  // Open and scroll to a section from a "#id" link (and on load with a hash).
  useEffect(() => {
    if (!openOnHash) return;
    const open = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const details = el instanceof HTMLDetailsElement ? el : el.querySelector("details");
      if (details) details.open = true;
      el.hidden = false;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href^='#']");
      if (!a) return;
      const id = decodeURIComponent(a.getAttribute("href")!.slice(1));
      if (id && open(id)) {
        e.preventDefault();
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
      }
    };
    if (window.location.hash) open(decodeURIComponent(window.location.hash.slice(1)));
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openOnHash]);

  return (
    <div ref={bar} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="w-full" autoComplete="off" />
      </label>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick filters">
          {[{ key: "", label: "All" }, ...chips].map((c) => {
            const on = (chip ?? "") === c.key;
            return (
              <button
                key={c.key || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setChip(c.key || null)}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${
                  on ? "border-primary bg-primary text-primary-fg" : "border-line-strong bg-surface text-foreground hover:border-primary hover:bg-primary-soft"
                }`}
              >
                {c.label}
                {c.key && <span data-chip-count={c.key} className={`tabular-nums ${on ? "" : "text-muted"}`} />}
              </button>
            );
          })}
        </div>
      )}
      <p data-filter-summary className="text-sm text-muted" aria-live="polite" />
    </div>
  );
}

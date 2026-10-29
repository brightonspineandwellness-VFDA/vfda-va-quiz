"use client";

import { useState } from "react";
import { grayCardAnswered, RISK_TAGS, type GrayCard, type GrayCardQuestion, type RiskTag } from "@/lib/interview";
import { inputClass } from "./answer-inputs";
import { SaveBadge } from "./save-badge";
import type { SaveState } from "./use-autosave";

const RISK_LABELS: Record<RiskTag, string> = {
  high_risk: "High risk",
  frequent: "Frequent",
  occasional: "Occasional",
};

export function GrayCards({
  cards,
  questions,
  addons,
  isAdmin,
  saveStates,
  onAdd,
  onChange,
  onRemove,
  onRisk,
  onRetry,
}: {
  cards: GrayCard[];
  questions: GrayCardQuestion[];
  addons: string[];
  isAdmin: boolean;
  saveStates: Record<string, SaveState>;
  onAdd: (name?: string) => Promise<void>;
  onChange: (cardId: string, key: string, value: string) => void;
  onRemove: (cardId: string) => Promise<void>;
  onRisk: (cardId: string, risk: RiskTag | null) => void;
  onRetry: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const cardNames = new Set(cards.map((c) => c.answers.CARD_NAME?.trim().toLowerCase()).filter(Boolean));
  const addonsWithoutCard = addons.filter((a) => a.trim() && !cardNames.has(a.trim().toLowerCase()));

  async function add(name?: string) {
    setAdding(true);
    await onAdd(name);
    setAdding(false);
  }

  return (
    <section id="gray-cards" className="flex scroll-mt-40 flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Gray cards</h2>
        <p className="text-sm text-foreground/60">
          One card per extra office-specific task. Each card becomes a gray card workflow (WF-G1, WF-G2, …),
          certified like the standard workflows and tested on Week 2 Day 5.
        </p>
      </div>

      {cards.map((card) => {
        const answered = grayCardAnswered(card, questions);
        return (
          <article
            key={card.id}
            id={`card-${card.id}`}
            className="scroll-mt-40 rounded-lg border border-foreground/15 p-4"
          >
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                <span className="font-mono">{card.code}</span>: {card.answers.CARD_NAME?.trim() || "Untitled"}
                <span className="ml-2 text-sm font-normal text-foreground/60">
                  {answered} of {questions.length} answered
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <SaveBadge state={saveStates[`card:${card.id}`]} onRetry={() => onRetry(`card:${card.id}`)} />
                {isAdmin ? (
                  <label className="flex items-center gap-1.5 text-sm">
                    Risk
                    <select
                      value={card.risk_tag ?? ""}
                      onChange={(e) => onRisk(card.id, (e.target.value || null) as RiskTag | null)}
                      className="rounded-md border border-foreground/20 bg-background px-2 py-1"
                    >
                      <option value="">Not set</option>
                      {RISK_TAGS.map((t) => (
                        <option key={t} value={t}>
                          {RISK_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  card.risk_tag && (
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs">{RISK_LABELS[card.risk_tag]}</span>
                  )
                )}
                {confirming === card.id ? (
                  <span className="flex items-center gap-1 text-sm">
                    Remove this card?
                    <button
                      type="button"
                      onClick={async () => {
                        await onRemove(card.id);
                        setConfirming(null);
                      }}
                      className="rounded-md bg-red-700 px-2 py-1 text-white"
                    >
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="rounded-md px-2 py-1 hover:bg-foreground/5">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(card.id)}
                    className="rounded-md px-2 py-1 text-sm text-foreground/60 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                  >
                    Remove
                  </button>
                )}
              </div>
            </header>
            <div className="grid gap-3">
              {questions.map((q) => (
                <label key={q.key} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{q.question}</span>
                  <textarea
                    rows={q.key === "CARD_NAME" ? 1 : 2}
                    value={card.answers[q.key] ?? ""}
                    onChange={(e) => onChange(card.id, q.key, e.target.value)}
                    className={`${inputClass} field-sizing-content`}
                  />
                </label>
              ))}
            </div>
          </article>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={adding}
          onClick={() => add()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          + Add gray card
        </button>
        {addonsWithoutCard.map((addon) => (
          <button
            key={addon}
            type="button"
            disabled={adding}
            onClick={() => add(addon)}
            className="rounded-lg border border-foreground/25 px-4 py-2 text-sm hover:bg-foreground/5 disabled:opacity-60"
          >
            + Card for add-on: {addon}
          </button>
        ))}
      </div>
    </section>
  );
}

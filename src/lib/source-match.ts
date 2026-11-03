// Forgiving checks of the card an item names and the words it quotes, as pure
// functions. Names match after normalizing ("Phone Scripts (WF04)" is "Phone
// Scripts"), or by a heading found inside a card; quotes match after
// normalizing both sides, or when at least 85% similar to a passage of a card
// or a VFDA standard. The passage found becomes the item's official quote.

export const STANDARDS_SOURCE = "VFDA standards";
// A quote at least this similar to a passage counts as that passage.
export const QUOTE_SIMILARITY = 0.85;
// Quotes are compared on at most this many words.
const MAX_QUOTE_WORDS = 80;

// Lowercase, without anything in parentheses or punctuation, spaces collapsed.
export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Lowercase, straight quotes, no punctuation, spaces collapsed.
export const normQuote = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export type NamedSource<C> = { kind: "card"; card: C } | { kind: "standards" } | null;

// The card (or the VFDA standards) a source_card value names: the exact title;
// a normalized name equal to, or containing, an allowed card name (longest
// first); or a heading/phrase found inside one card's text.
export function matchCardName<C extends { title: string; text: string }>(value: string, cards: C[]): NamedSource<C> {
  const exact = cards.find((c) => c.title === value);
  if (exact) return { kind: "card", card: exact };
  const n = normName(value);
  if (!n) return null;
  if (n === normName(STANDARDS_SOURCE) || n.includes("vfda standard")) return { kind: "standards" };
  const named = cards.map((card) => ({ card, key: normName(card.title) })).filter((x) => x.key);
  const equal = named.find((x) => x.key === n);
  if (equal) return { kind: "card", card: equal.card };
  const containing = named.filter((x) => ` ${n} `.includes(` ${x.key} `)).sort((a, b) => b.key.length - a.key.length)[0];
  if (containing) return { kind: "card", card: containing.card };
  if (n.length >= 4) {
    const inText = cards.find((c) => ` ${normName(c.text)} `.includes(` ${n} `));
    if (inText) return { kind: "card", card: inText };
  }
  return null;
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export const similarity = (a: string, b: string) => {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
};

// The passage of `text` the quote comes from (as written in the text), with
// how similar it is (1 = the same after normalizing). Null when nothing
// reaches QUOTE_SIMILARITY; `best` says how close the nearest one came.
export function findPassage(quote: string, text: string): { passage: string; score: number } | { passage: null; best: number } {
  const q = normQuote(quote).split(" ").filter(Boolean).slice(0, MAX_QUOTE_WORDS);
  const words = [...text.matchAll(/\S+/g)]
    .map((m) => ({ start: m.index, end: m.index + m[0].length, n: normQuote(m[0]) }))
    .filter((w) => w.n);
  if (!q.length || !words.length) return { passage: null, best: 0 };
  const passage = (i: number, len: number) => text.slice(words[i].start, words[i + len - 1].end);
  const m = q.length;
  const joinedQ = q.join(" ");

  // Exact, after normalizing.
  for (let i = 0; i + m <= words.length; i++) {
    let k = 0;
    while (k < m && words[i + k].n === q[k]) k++;
    if (k === m) return { passage: passage(i, m), score: 1 };
  }
  // Fuzzy: the windows sharing the most words with the quote, compared letter by letter.
  const qWords = new Set(q);
  const starts: { i: number; shared: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    let shared = 0;
    for (let k = i; k < Math.min(words.length, i + m); k++) if (qWords.has(words[k].n)) shared++;
    if (shared / m >= 0.5) starts.push({ i, shared });
  }
  starts.sort((a, b) => b.shared - a.shared);
  let best = { i: -1, len: 0, score: 0 };
  const minLen = Math.max(1, Math.floor(m * 0.8));
  const maxLen = Math.ceil(m * 1.2);
  for (const { i } of starts.slice(0, 12)) {
    for (let len = minLen; len <= maxLen && i + len <= words.length; len++) {
      const score = similarity(
        words
          .slice(i, i + len)
          .map((w) => w.n)
          .join(" "),
        joinedQ,
      );
      if (score > best.score) best = { i, len, score };
    }
  }
  return best.score >= QUOTE_SIMILARITY ? { passage: passage(best.i, best.len), score: best.score } : { passage: null, best: best.score };
}

export type SourceResult<C> =
  | { ok: true; card: C | null; source_card: string; source_quote: string; score: number }
  | { ok: false; field: "source_card" | "source_quote"; value: string; reason: string };

// Where an item's quote comes from: the card it names first, then the day's
// other cards, then the VFDA standards. The passage found replaces the quote.
export function resolveSource<C extends { title: string; text: string }>(
  sourceCard: string,
  sourceQuote: string,
  cards: C[],
  standards: { key: string; value: string }[],
): SourceResult<C> {
  if (!sourceQuote.trim()) return { ok: false, field: "source_quote", value: "", reason: "missing: quote the card's own words" };
  const named = matchCardName(sourceCard, cards);
  type Target = { card: C | null; text: string };
  const cardTargets: Target[] = cards.map((card) => ({ card, text: card.text }));
  const standardTargets: Target[] = standards.map((s) => ({ card: null, text: s.value }));
  const targets: Target[] =
    named?.kind === "card"
      ? [cardTargets.find((t) => t.card === named.card)!, ...cardTargets.filter((t) => t.card !== named.card), ...standardTargets]
      : named?.kind === "standards"
        ? [...standardTargets, ...cardTargets]
        : [...cardTargets, ...standardTargets];
  let closest = 0;
  for (const t of targets) {
    const found = findPassage(sourceQuote, t.text);
    if (found.passage !== null) {
      return { ok: true, card: t.card, source_card: t.card?.title ?? STANDARDS_SOURCE, source_quote: found.passage, score: found.score };
    }
    closest = Math.max(closest, found.best);
  }
  if (!named) {
    return {
      ok: false,
      field: "source_card",
      value: sourceCard,
      reason: `not one of this day's cards (${[...cards.map((c) => `"${c.title}"`), `"${STANDARDS_SOURCE}"`].join(", ")}), and the quote isn't in any of them`,
    };
  }
  const where = named.kind === "card" ? `"${named.card.title}"` : STANDARDS_SOURCE;
  return {
    ok: false,
    field: "source_quote",
    value: sourceQuote,
    reason: `not found in ${where} or the other cards (closest passage ${Math.round(closest * 100)}% similar; needs ${Math.round(QUOTE_SIMILARITY * 100)}%)`,
  };
}

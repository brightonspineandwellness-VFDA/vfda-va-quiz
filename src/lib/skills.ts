// "Skills you showed": short skill names grouped by workflow, shown as a
// checkmark list to VAs and doctors (never scores). Stored lines look like
// "[Workflow name] Verifying callers"; older reports only have strength
// sentences, which shortSkill turns into a short name.

export type WentWellGroup = { name: string | null; bullets: string[] };

// "[Scheduling] You offered two times..." -> group and text.
export function parseStrength(line: string): { group: string | null; text: string } {
  const m = /^\s*\[([^\]]{1,80})\]\s*(.+)$/.exec(line);
  return m ? { group: m[1].trim(), text: m[2].trim() } : { group: null, text: line.trim() };
}

export function groupStrengths(lines: string[]): WentWellGroup[] {
  const groups: WentWellGroup[] = [];
  for (const l of lines) {
    const { group, text } = parseStrength(l);
    if (!text) continue;
    const g = groups.find((x) => x.name === group);
    if (g) g.bullets.push(text);
    else groups.push({ name: group, bullets: [text] });
  }
  return groups;
}

// A short skill name from a strength sentence, for reports written before
// skills were stored: "You verified every caller before sharing details,
// just like ..." -> "Verified every caller before sharing details".
export function shortSkill(sentence: string): string {
  const t = parseStrength(sentence)
    .text.replace(/^(great job|nice work|well done|good job)[,!:]?\s*/i, "")
    .replace(/^you\s+(did a (great|good) job\s+(of\s+)?)?/i, "")
    .split(/,|;|\s+(just like|as the|as your|like the|following|exactly as|so that|which)\b|\.\s/i)[0]
    .replace(/[.\s]+$/, "")
    .trim();
  const words = t.split(/\s+/);
  const short = words.length > 9 ? `${words.slice(0, 8).join(" ")}…` : t;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

// "Skills you showed": the stored skills, else short names from the strengths.
export function skillsOf(t: { skills?: string[]; strengths: string[] }): WentWellGroup[] {
  const lines = t.skills?.length
    ? t.skills
    : t.strengths.map((s) => {
        const { group } = parseStrength(s);
        return `${group ? `[${group}] ` : ""}${shortSkill(s)}`;
      });
  const groups = groupStrengths(lines);
  for (const g of groups) g.bullets = [...new Set(g.bullets)];
  return groups;
}

export const skillCount = (groups: WentWellGroup[]) => groups.reduce((n, g) => n + g.bullets.length, 0);


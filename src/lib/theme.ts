// The one theme for the app and the PDF reports: colors, spacing, radius and
// font sizes. The pages get these as CSS variables (themeCss(), injected by
// src/app/layout.tsx and mapped to Tailwind colors in globals.css); the PDFs
// (src/lib/pdf-kit.ts) read the same values. No server-only imports, so the
// PDF code and client components can both use it.
//
// Navy and teal are picked to sit with the logo's royal blue (#4F64E0). Every
// text color passes WCAG AA (4.5:1) on the surfaces it's used on.

export const LOGO = {
  path: "/vfda-logo.jpg",
  // Used in emails, which need a full URL to show the image.
  url: "https://vfda-va-quiz.vercel.app/vfda-logo.jpg",
  alt: "Virtual Front Desk Academy",
  width: 268,
  height: 108,
} as const;

type Palette = {
  background: string; // page
  surface: string; // cards
  surfaceMuted: string; // table header, quiet panels
  surfaceZebra: string; // every other table row
  foreground: string; // body text
  muted: string; // secondary text (never under 13px)
  border: string;
  borderStrong: string; // inputs
  primary: string; // navy: buttons and links
  primaryHover: string;
  primaryFg: string; // text on a primary button
  primarySoft: string; // selected answer, active row
  accent: string; // teal: progress bar, "Try it again"
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  focus: string; // keyboard focus ring
};

export const colors: { light: Palette; dark: Palette } = {
  light: {
    background: "#F4F6F9",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF1F5",
    surfaceZebra: "#F8FAFC",
    foreground: "#1F2937",
    muted: "#5B6472",
    border: "#DCE1E8",
    borderStrong: "#B8C0CC",
    primary: "#1E2A6B",
    primaryHover: "#2B3A8C",
    primaryFg: "#FFFFFF",
    primarySoft: "#EEF0FB",
    accent: "#0F766E",
    accentSoft: "#E6F4F1",
    success: "#15803D",
    successSoft: "#E7F5EC",
    warning: "#A15C07",
    warningSoft: "#FDF3E1",
    danger: "#B91C1C",
    dangerSoft: "#FDECEC",
    info: "#1D4ED8",
    infoSoft: "#EAF1FD",
    focus: "#4F64E0",
  },
  dark: {
    background: "#0E1320",
    surface: "#161C2B",
    surfaceMuted: "#1D2536",
    surfaceZebra: "#1A2131",
    foreground: "#E6E9EF",
    muted: "#A6AFBE",
    border: "#2C3548",
    borderStrong: "#465068",
    primary: "#9AA8F5",
    primaryHover: "#B4BEF8",
    primaryFg: "#0E1320",
    primarySoft: "#232C4D",
    accent: "#3CC9B6",
    accentSoft: "#12302D",
    success: "#4ADE80",
    successSoft: "#13301E",
    warning: "#FBBF24",
    warningSoft: "#33270C",
    danger: "#F87171",
    dangerSoft: "#3A1717",
    info: "#7AB0FF",
    infoSoft: "#14264A",
    focus: "#9AA8F5",
  },
};

export const font = {
  family: "var(--font-inter), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  base: 16, // px
  small: 14,
  min: 13, // secondary text never goes under this
  h1: 24,
  h2: 18,
  h3: 16,
  lineHeight: 1.5,
} as const;

export const radius = { card: 8, control: 8, pill: 999 } as const;
export const space = {
  cardPad: 20,
  cardPadSm: 16,
  gap: 16,
  gapLg: 24,
  cell: 12,
} as const;
export const layout = {
  maxWidth: 1100,
  gutter: 16,
  controlHeight: 40,
} as const;

// Statuses as pill badges: one tone per meaning.
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary" | "accent";

const TONE_OF: Record<string, Tone> = {
  approved: "success",
  done: "success",
  certified: "success",
  strong: "success",
  live: "success",
  accepted: "success",
  passed: "success",
  open: "info",
  "needs coaching": "warning",
  "needs review": "warning",
  pending: "warning",
  draft: "neutral",
  invited: "info",
  training: "primary",
  retake: "accent",
  "at risk": "danger",
  critical: "danger",
  failed: "danger",
  rejected: "danger",
  locked: "neutral",
};

// The tone of a status label ("Strong", "Needs coaching", ...); neutral when unknown.
export const toneOf = (label: string): Tone => TONE_OF[label.trim().toLowerCase()] ?? "neutral";

// The CSS variables for the pages: light by default, dark only when the
// device is set to dark.
export function themeCss(): string {
  const vars = (p: Palette) =>
    Object.entries(p)
      .map(([k, v]) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v};`)
      .join("");
  const sizes = `--max-content:${layout.maxWidth}px;--radius-card:${radius.card}px;--radius-control:${radius.control}px;--control-h:${layout.controlHeight}px;`;
  return `:root{${vars(colors.light)}${sizes}color-scheme:light;}@media (prefers-color-scheme: dark){:root{${vars(colors.dark)}color-scheme:dark;}}`;
}

// "#1E2A6B" -> [0.118, 0.165, 0.42], for pdf-lib's rgb().
export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

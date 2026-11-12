// Shared building blocks for every page: PageHeader (title, one-line
// description, breadcrumbs), Card, SectionHeader, Badge / StatusBadge, Button
// / ButtonLink, Table, Notice, Stepper, Field, EmptyState, Skeleton and
// StatTile. Colors, radius and sizes come from src/lib/theme.ts (as CSS
// variables, mapped to Tailwind colors in globals.css). Server-safe: no hooks.

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { toneOf, type Tone } from "@/lib/theme";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Page header and breadcrumbs
// ---------------------------------------------------------------------------

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((c, n) => (
          <li key={`${c.label}-${n}`} className="flex items-center gap-1.5">
            {n > 0 && <span aria-hidden="true">›</span>}
            {c.href && n < items.length - 1 ? (
              <Link href={c.href} className="text-primary hover:underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current={n === items.length - 1 ? "page" : undefined} className={n === items.length - 1 ? "text-foreground" : ""}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold text-foreground">
            {title}
            {badge}
          </h1>
          {description && <p className="text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Cards and section headers
// ---------------------------------------------------------------------------

export function NumberBadge({ n, tone = "primary" }: { n: number | string; tone?: "primary" | "success" | "accent" }) {
  const bg = tone === "success" ? "bg-success" : tone === "accent" ? "bg-accent" : "bg-primary";
  return (
    <span
      className={cx("inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-sm font-semibold", bg, "text-primary-fg")}
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

export function SectionHeader({
  title,
  number,
  description,
  actions,
  as: Tag = "h2",
}: {
  title: ReactNode;
  number?: number | string;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-3">
        {number !== undefined && <NumberBadge n={number} />}
        <div className="flex min-w-0 flex-col gap-0.5">
          <Tag className={cx("font-semibold text-foreground", Tag === "h2" ? "text-lg" : "text-base")}>{title}</Tag>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// A section in a card: 1px border, 8px corners, light shadow, a header row.
export function Card({
  title,
  number,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  as: Tag = "section",
  headingAs,
  accent,
}: {
  title?: ReactNode;
  number?: number | string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  as?: "section" | "div" | "article" | "li";
  headingAs?: "h2" | "h3";
  // A colored left border (e.g. "accent" for "Try it again").
  accent?: Tone;
}) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <Tag
      id={id}
      className={cx(
        "min-w-0 rounded-[var(--radius-card)] border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.06)]",
        accent && cx("border-l-4", TONE[accent].left),
        className,
      )}
    >
      {hasHeader && (
        <div className="border-b border-line px-4 py-3 sm:px-6">
          <SectionHeader title={title} number={number} description={description} actions={actions} as={headingAs} />
        </div>
      )}
      {children !== undefined && children !== null && <div className={cx("flex flex-col gap-3 px-4 py-4 sm:px-6 sm:py-5", bodyClassName)}>{children}</div>}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export const TONE: Record<Tone, { text: string; soft: string; border: string; left: string; solid: string }> = {
  success: {
    text: "text-success",
    soft: "bg-success-soft",
    border: "border-success",
    left: "border-l-success",
    solid: "bg-success",
  },
  warning: {
    text: "text-warning",
    soft: "bg-warning-soft",
    border: "border-warning",
    left: "border-l-warning",
    solid: "bg-warning",
  },
  danger: {
    text: "text-danger",
    soft: "bg-danger-soft",
    border: "border-danger",
    left: "border-l-danger",
    solid: "bg-danger",
  },
  info: {
    text: "text-info",
    soft: "bg-info-soft",
    border: "border-info",
    left: "border-l-info",
    solid: "bg-info",
  },
  neutral: {
    text: "text-muted",
    soft: "bg-surface-muted",
    border: "border-line-strong",
    left: "border-l-line-strong",
    solid: "bg-muted",
  },
  primary: {
    text: "text-primary",
    soft: "bg-primary-soft",
    border: "border-primary",
    left: "border-l-primary",
    solid: "bg-primary",
  },
  accent: {
    text: "text-accent",
    soft: "bg-accent-soft",
    border: "border-accent",
    left: "border-l-accent",
    solid: "bg-accent",
  },
};

export function Badge({ children, tone = "neutral", size = "sm", className }: { children: ReactNode; tone?: Tone; size?: "sm" | "lg"; className?: string }) {
  const t = TONE[tone];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-semibold",
        size === "lg" ? "px-3.5 py-1 text-base" : "px-2.5 py-0.5 text-xs",
        t.text,
        t.soft,
        t.border,
        className,
      )}
    >
      {children}
    </span>
  );
}

// Approved, Draft, Needs review, Invited, Training, Certified, Retake,
// Strong, Needs coaching, At risk, ...: the tone comes from the label.
export function StatusBadge({ label, size, tone }: { label: string; size?: "sm" | "lg"; tone?: Tone }) {
  return (
    <Badge tone={tone ?? toneOf(label)} size={size}>
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Buttons: same height and radius everywhere
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "accent";

export function buttonClass(variant: ButtonVariant = "secondary", size: "md" | "sm" = "md", className?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border font-medium no-underline transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
    size === "md" ? "min-h-10 px-4 py-2 text-[0.9375rem]" : "min-h-8 px-3 py-1 text-sm",
    variant === "primary" && "border-primary bg-primary text-primary-fg hover:border-primary-hover hover:bg-primary-hover",
    variant === "accent" && "border-accent bg-accent text-primary-fg hover:opacity-90",
    variant === "secondary" && "border-line-strong bg-surface text-primary hover:border-primary hover:bg-primary-soft",
    variant === "danger" && "border-danger bg-surface text-danger hover:bg-danger-soft",
    variant === "ghost" && "border-transparent bg-transparent text-primary hover:bg-primary-soft",
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "md" | "sm" }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
}) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

// A plain <a> (downloads, route handlers that aren't pages).
export function ButtonAnchor({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"a"> & { variant?: ButtonVariant; size?: "md" | "sm" }) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}

export const linkClass = "font-medium text-primary underline-offset-2 hover:underline";

// ---------------------------------------------------------------------------
// Tables: gray header, row borders, zebra rows, sticky header, numbers right
// ---------------------------------------------------------------------------

export function Table({ children, className, maxHeight }: { children: ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div
      className={cx("w-full overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-left text-[0.9375rem] [&_tbody_tr:nth-child(even)]:bg-surface-zebra [&_tbody_tr]:border-t [&_tbody_tr]:border-line">
        {children}
      </table>
    </div>
  );
}

export const th = "sticky top-0 z-10 bg-surface-muted px-3 py-2.5 text-left text-sm font-semibold text-foreground";
export const thNum = cx(th, "text-right");
export const td = "px-3 py-2.5 align-top";
export const tdNum = "px-3 py-2.5 align-top text-right tabular-nums";

// ---------------------------------------------------------------------------
// Notices: a box with a colored left border
// ---------------------------------------------------------------------------

export function Notice({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status" | "note";
}) {
  const t = TONE[tone];
  return (
    <div role={role} className={cx("rounded-[var(--radius-card)] border border-l-4 border-line px-4 py-3", t.soft, t.left, className)}>
      {title && <p className={cx("font-semibold", tone === "neutral" ? "text-foreground" : t.text)}>{title}</p>}
      {children && <div className={cx("flex flex-col gap-1.5 text-[0.9375rem] text-foreground", title ? "mt-1" : "")}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper: numbered circles, a green check when done
// ---------------------------------------------------------------------------

export type Step = {
  label: string;
  state: "done" | "current" | "todo" | "locked";
  href?: string;
  detail?: string;
};

export function Stepper({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cx("flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0", className)}>
      {steps.map((s, n) => {
        const circle =
          s.state === "done"
            ? "border-success bg-success text-primary-fg"
            : s.state === "current"
              ? "border-primary bg-primary text-primary-fg"
              : "border-line-strong bg-surface text-muted";
        const label = (
          <span className="flex min-w-0 flex-col">
            <span className={cx("text-sm font-semibold", s.state === "todo" || s.state === "locked" ? "text-muted" : "text-foreground")}>{s.label}</span>
            {s.detail && <span className="text-xs text-muted">{s.detail}</span>}
          </span>
        );
        return (
          <li key={s.label} className="relative flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:text-center">
            {n > 0 && (
              <span
                aria-hidden="true"
                className={cx(
                  "absolute top-4 right-1/2 hidden h-0.5 w-full -translate-x-4 sm:block",
                  s.state === "done" || s.state === "current" ? "bg-primary/40" : "bg-line",
                )}
              />
            )}
            <span className={cx("relative z-[1] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold", circle)}>
              {s.state === "done" ? (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                n + 1
              )}
            </span>
            <span className="sr-only">{s.state === "done" ? "Done: " : s.state === "current" ? "Current step: " : ""}</span>
            {s.href && s.state !== "locked" ? (
              <Link href={s.href} className="hover:underline" aria-current={s.state === "current" ? "step" : undefined}>
                {label}
              </Link>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Forms: label above the input, helper text in gray, error in red
// ---------------------------------------------------------------------------

export function Field({
  label,
  htmlFor,
  helper,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      {children}
      {helper && <p className="text-sm text-muted">{helper}</p>}
      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass = "w-full";

// ---------------------------------------------------------------------------
// Empty states, skeletons and stat tiles
// ---------------------------------------------------------------------------

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" className="text-muted">
        <path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <p className="font-semibold text-foreground">{title}</p>
      {children && <div className="max-w-prose text-[0.9375rem] text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-pulse rounded bg-surface-muted", className)} />;
}

// A loading placeholder in the shape of a card.
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-5 sm:px-6">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }, (_, n) => (
        <Skeleton key={n} className={cx("h-4", n % 2 ? "w-4/5" : "w-full")} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function StatTile({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
      <span className="text-sm text-muted">{label}</span>
      <span className={cx("text-2xl font-semibold tabular-nums", tone ? TONE[tone].text : "text-foreground")}>{value}</span>
      {sub && <span className="text-sm text-muted">{sub}</span>}
    </div>
  );
}

// A thin progress bar (teal).
export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max ? Math.max(0, Math.min(100, (value * 100) / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
    >
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

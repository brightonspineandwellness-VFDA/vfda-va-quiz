import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass, SkeletonCard } from "@/components/ui";
import { LOGO } from "@/lib/theme";

// Each area's home page, for the logo link.
const HOME: Record<string, string> = {
  "VFDA admin": "/admin",
  Doctor: "/doctor",
  VA: "/va",
};

// The logo, kept to its proportions. A JPG with a white background, so it's
// only ever placed on white.
export function Logo({ height = 32, className }: { height?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO.path}
      alt={LOGO.alt}
      height={height}
      width={Math.round((height * LOGO.width) / LOGO.height)}
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}

// Page frame for signed-in pages: a white top bar with the logo (linking to
// the area's home), the area name and a sign-out button, then the page,
// centered at ~1100px. Keep anything private out of here; it renders before
// the role check streams in.
export function SignedInPage({ area, children }: { area: string; children: ReactNode }) {
  const home = HOME[area] ?? "/";
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#DCE1E8] bg-white print:hidden">
        <div className="mx-auto flex w-full max-w-[var(--max-content)] items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={home} aria-label={`${LOGO.alt}: home`} className="shrink-0 rounded">
              <Logo height={32} />
            </Link>
            <span className="hidden truncate border-l border-[#DCE1E8] pl-3 text-sm font-medium text-[#5B6472] sm:inline">{area}</span>
          </div>
          <form action="/auth/signout" method="post">
            {/* Fixed light colors: the bar stays white in dark mode too (the logo is a JPG on white). */}
            <button type="submit" className={buttonClass("secondary", "sm", "border-[#B8C0CC] bg-white text-[#1E2A6B] hover:bg-[#EEF0FB]")}>
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[var(--max-content)] flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

// The loading state of a page section.
export function Loading() {
  return <SkeletonCard lines={4} />;
}

import type { ReactNode } from "react";

// Page frame for signed-in pages: header with the area name and a sign-out button.
// Keep anything private out of here; it renders before the role check streams in.
export function SignedInPage({ area, children }: { area: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-foreground/10 px-6 py-4">
        <p className="font-semibold">
          VFDA VA Quiz App <span className="font-normal text-foreground/60">· {area}</span>
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">{children}</main>
    </div>
  );
}

export function Loading() {
  return <p className="text-foreground/60">Loading…</p>;
}

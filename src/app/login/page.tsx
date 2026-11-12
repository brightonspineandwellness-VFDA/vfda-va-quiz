import { Suspense } from "react";
import { Logo } from "@/components/signed-in-page";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex justify-center rounded-[var(--radius-card)] bg-white px-6 py-5">
        <Logo height={64} />
      </div>
      <div className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface px-6 py-6 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
        <div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-muted">Sign in with your email. No password needed.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

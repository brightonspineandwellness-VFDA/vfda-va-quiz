import Link from "next/link";
import { Suspense } from "react";
import { LockedStep, nextButton } from "@/components/setup/locked-step";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "../load";

export default function ConfirmPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup/review" className="text-sm text-foreground/60 hover:underline">
        ← Waiting for VFDA review
      </Link>
      <Suspense fallback={<Loading />}>
        <ConfirmStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 4: the card groups where the cards had rules.
async function ConfirmStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  const next = flow.groups.find((g) => !g.confirmed);

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="confirm" />
      <div>
        <h2 className="text-xl font-semibold">Step 4 · Confirm your rules</h2>
        <p className="text-foreground/70">
          The rules we found on your cards, checked by VFDA. Look over each group: if it looks right, say so; if
          something is off, edit it.
        </p>
      </div>

      {!flow.unlocked ? (
        <LockedStep />
      ) : (
        <>
          {flow.groups.length === 0 ? (
            <p className="text-foreground/70">Your cards didn&apos;t have rules to confirm. Nothing to do here.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {flow.groups.map((g, i) => {
                const toCheck = g.items.filter((it) => it.kind === "card" && !it.confirmed).length;
                return (
                  <li key={g.slug}>
                    <Link
                      href={`/doctor/setup/confirm/${g.slug}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-foreground/15 px-4 py-3 hover:border-foreground/40"
                    >
                      <span className="font-medium">
                        {i + 1}. {g.name}
                      </span>
                      <span className="text-sm text-foreground/60">
                        {g.confirmed ? (
                          <span className="text-green-700 dark:text-green-400">Confirmed ✓</span>
                        ) : (
                          `${toCheck} to check`
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
          <Link href={next ? `/doctor/setup/confirm/${next.slug}` : "/doctor/setup/questions"} className={nextButton}>
            {next ? `Start with ${next.name} →` : "Next: Questions for you →"}
          </Link>
        </>
      )}
    </>
  );
}

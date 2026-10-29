import Link from "next/link";
import { Suspense } from "react";
import { StepProgress } from "@/components/setup/step-progress";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { loadDoctorSetup } from "../load";

export default function CardsPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor/setup" className="text-sm text-foreground/60 hover:underline">
        ← Setup
      </Link>
      <Suspense fallback={<Loading />}>
        <CardsStep />
      </Suspense>
    </SignedInPage>
  );
}

// Step 2: one screen per card group.
async function CardsStep() {
  const setup = await loadDoctorSetup();
  if (!setup) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;
  const { interview, flow } = setup;
  const next = flow.groups.find((g) => !g.confirmed);

  return (
    <>
      <h1 className="text-2xl font-semibold">Office setup: {interview.office.name}</h1>
      <StepProgress steps={flow.steps} current="cards" />
      <div>
        <h2 className="text-xl font-semibold">Step 2 · Your cards</h2>
        <p className="text-foreground/70">
          VFDA read your Trello cards and pulled out the rules your VA needs. Check each group: if it looks right,
          say so; if something is off, edit it.
        </p>
      </div>

      {!flow.cardsReady && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {flow.awaitingReview
            ? "VFDA is still reviewing the rules from your cards. You'll be able to check them here soon."
            : "VFDA hasn't uploaded your cards yet. Nothing to do here for now."}
        </p>
      )}

      {flow.cardsReady && (
        <>
          <ol className="flex flex-col gap-2">
            {flow.groups.map((g, i) => {
              const questions = g.items.filter((it) => it.kind === "question").length;
              const toCheck = g.items.filter((it) => it.kind === "rule" && !it.confirmed).length;
              return (
                <li key={g.slug}>
                  <Link
                    href={`/doctor/setup/cards/${g.slug}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-foreground/15 px-4 py-3 hover:border-foreground/40"
                  >
                    <span className="font-medium">
                      {i + 1}. {g.name}
                    </span>
                    <span className="text-sm text-foreground/60">
                      {g.confirmed ? (
                        <span className="text-green-700 dark:text-green-400">Confirmed ✓</span>
                      ) : (
                        [toCheck && `${toCheck} to check`, questions && `${questions} question${questions > 1 ? "s" : ""}`]
                          .filter(Boolean)
                          .join(" · ")
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {next ? (
            <Link
              href={`/doctor/setup/cards/${next.slug}`}
              className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background"
            >
              Start with {next.name} →
            </Link>
          ) : (
            <Link
              href="/doctor/setup/standards"
              className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background"
            >
              Next: VFDA standards →
            </Link>
          )}
        </>
      )}
    </>
  );
}

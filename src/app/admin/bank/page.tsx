import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { getBankOverview, type Tally } from "@/lib/quiz-bank";
import { pointsLabel } from "./bank-text";

export default function BankPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">Quiz bank</h1>
      <Suspense fallback={<Loading />}>
        <BankOverview />
      </Suspense>
    </SignedInPage>
  );
}

async function BankOverview() {
  await requireRole("vfda_admin");
  const { quizzes, bankInfo } = await getBankOverview();

  if (quizzes.length === 0) {
    return (
      <p className="rounded-lg border border-foreground/15 px-4 py-3">
        The bank is empty. Run <code>npm run import:bank</code> on your computer.
      </p>
    );
  }

  const totalItems = quizzes.reduce((sum, q) => sum + q.itemCount, 0);
  return (
    <>
      <p className="text-foreground/70">
        {quizzes.length} quizzes · {totalItems} items
        {bankInfo?.version ? ` · bank version ${bankInfo.version}` : ""} · read-only
      </p>
      <ol className="flex flex-col gap-3">
        {quizzes.map((quiz) => (
          <li key={quiz.id}>
            <Link
              href={`/admin/bank/${quiz.code}`}
              className="block rounded-lg border border-foreground/15 px-4 py-3 hover:border-foreground/40"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="font-medium">
                  <span className="font-mono">{quiz.code}</span> · {quiz.title}
                </p>
                <p className="text-sm text-foreground/60">
                  {quiz.itemCount} items · {pointsLabel(quiz)}
                </p>
              </div>
              <p className="mt-1 text-sm text-foreground/60">
                Office gets it: {quiz.condition} · answers: {quiz.answer_format}
              </p>
              {quiz.itemCount === 0 ? (
                <p className="mt-2 text-sm">No fixed items: built per office from its gray cards.</p>
              ) : (
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <Counts title="By part" rows={quiz.byPart} />
                  <Counts title="By condition" rows={quiz.byCondition} />
                </div>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

function Counts({ title, rows }: { title: string; rows: Tally[] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{title}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="flex justify-between gap-2">
            <span>{row.label}</span>
            <span className="tabular-nums text-foreground/70">{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

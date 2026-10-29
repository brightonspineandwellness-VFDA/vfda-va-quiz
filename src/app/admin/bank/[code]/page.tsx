import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { getQuizWithItems, type QuestionTemplate } from "@/lib/quiz-bank";
import { BankText, pointsLabel } from "../bank-text";

export default function BankQuizPage({ params }: PageProps<"/admin/bank/[code]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/bank" className="text-sm text-foreground/60 hover:underline">
        ← Quiz bank
      </Link>
      <Suspense fallback={<Loading />}>
        <BankQuiz params={params} />
      </Suspense>
    </SignedInPage>
  );
}

async function BankQuiz({ params }: { params: Promise<{ code: string }> }) {
  await requireRole("vfda_admin");
  const { code } = await params;
  const data = await getQuizWithItems(code);
  if (!data) notFound();
  const { quiz, items } = data;

  // Group items by part, keeping bank order.
  const parts = new Map<string, QuestionTemplate[]>();
  for (const item of items) parts.set(item.part, [...(parts.get(item.part) ?? []), item]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">
          <span className="font-mono">{quiz.code}</span> · {quiz.title}
        </h1>
        <p className="mt-1 text-foreground/70">
          Week {quiz.week}, day {quiz.day} · {pointsLabel(quiz)} · office gets it: {quiz.condition}{" "}
          · answers: {quiz.answer_format}
        </p>
      </div>

      <dl className="grid gap-2 text-sm">
        <Field label="Cards">{quiz.cards.join(" · ") || "—"}</Field>
        <Field label="Proof of work">{quiz.proof_of_work.join(" · ") || "—"}</Field>
        {quiz.notes && (
          <Field label="Notes">
            <BankText text={quiz.notes} />
          </Field>
        )}
      </dl>

      {items.length === 0 && (
        <p className="rounded-lg border border-foreground/15 px-4 py-3">
          No fixed items: this quiz is built per office from its gray cards.
        </p>
      )}

      {[...parts.entries()].map(([part, partItems]) => (
        <section key={part} className="flex flex-col gap-2">
          <h2 className="mt-4 text-lg font-semibold">
            Part {part}
            {partItems[0].part_title && ` · ${partItems[0].part_title}`}
            <span className="ml-2 text-sm font-normal text-foreground/60">
              {partItems.length} items
            </span>
          </h2>
          {partItems.map((item) => (
            <Item key={item.id} quizCode={quiz.code} item={item} />
          ))}
        </section>
      ))}
    </>
  );
}

function Item({ quizCode, item }: { quizCode: string; item: QuestionTemplate }) {
  return (
    <details
      id={`${quizCode}-${item.code}-${item.version}`}
      className="rounded-lg border border-foreground/15 px-4 py-2 open:pb-4"
    >
      <summary className="cursor-pointer list-inside">
        <span className="font-mono font-medium">{item.code}</span>
        <span className="ml-2 text-xs text-foreground/60">
          v{item.version} · {item.type === "mc" ? "multiple choice" : "situational"} ·{" "}
          {item.points} pt{item.points > 1 ? "s" : ""}
          {item.condition !== "always" && ` · only if ${item.condition}`}
        </span>
        <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{item.stem}</p>
      </summary>

      <dl className="mt-3 grid gap-3 text-sm">
        <Field label="Question">
          <BankText text={item.stem} />
        </Field>

        {item.type === "mc" && item.options && (
          <Field label="Options">
            <ol className="list-[upper-alpha] pl-5">
              {item.options.map((option, i) => (
                <li key={i}>
                  <BankText text={option} />
                </li>
              ))}
            </ol>
          </Field>
        )}
        {item.type === "mc" && item.options_rule && (
          <Field label="Options (built per office in Phase 4)">
            <BankText text={item.options_rule} />
          </Field>
        )}
        {item.answer && (
          <Field label="Answer">
            <BankText text={item.answer} />
          </Field>
        )}

        {Array.isArray(item.look_for) && (
          <Field label="Look for">
            <PointList points={item.look_for} />
          </Field>
        )}
        {item.look_for && !Array.isArray(item.look_for) && (
          <Field label="Look for">
            <div className="grid gap-2 sm:grid-cols-3">
              {(["Say", "Do", "Book"] as const).map((part) => (
                <div key={part}>
                  <p className="font-medium">{part}</p>
                  {item.look_for && !Array.isArray(item.look_for) && item.look_for[part].length ? (
                    <PointList points={item.look_for[part]} />
                  ) : (
                    <p className="text-foreground/50">Nothing required</p>
                  )}
                </div>
              ))}
            </div>
          </Field>
        )}

        {item.critical_fail && (
          <Field label="Critical fail">
            <span className="text-red-700 dark:text-red-400">
              <BankText text={item.critical_fail} />
            </span>
          </Field>
        )}
        <Field label="Source">
          {item.bank_ref || "—"}
          {item.answer_format && ` · answers: ${item.answer_format}`}
        </Field>
      </dl>
    </details>
  );
}

function PointList({ points }: { points: string[] }) {
  return (
    <ul className="list-disc pl-5">
      {points.map((point, i) => (
        <li key={i}>
          <BankText text={point} />
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-foreground/50">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

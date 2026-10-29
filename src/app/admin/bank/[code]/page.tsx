import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { getWorkflowWithScenarios, type Scenario } from "@/lib/library";
import { BankText, pointsLabel } from "../bank-text";

export default function WorkflowPage({ params }: PageProps<"/admin/bank/[code]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin/bank" className="text-sm text-foreground/60 hover:underline">
        ← Library
      </Link>
      <Suspense fallback={<Loading />}>
        <WorkflowDetail params={params} />
      </Suspense>
    </SignedInPage>
  );
}

const ESCALATION_LABELS = { none: "No escalation", approval: "Needs approval", immediate: "Escalate immediately" };

async function WorkflowDetail({ params }: { params: Promise<{ code: string }> }) {
  await requireRole("vfda_admin");
  const { code } = await params;
  const data = await getWorkflowWithScenarios(code);
  if (!data) notFound();
  const { workflow: wf, byDay, scenarioCount, ruleQuestions } = data;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">
          <span className="font-mono">{wf.code}</span> · {wf.name}
        </h1>
        <p className="mt-1 text-foreground/70">
          {scenarioCount} scenarios across {byDay.length} training day{byDay.length === 1 ? "" : "s"} · read-only
        </p>
      </div>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <Field label="Trigger" wide>
          <BankText text={wf.trigger} />
        </Field>
        <Field label="Required information">
          <Points points={wf.required_information} />
        </Field>
        <Field label="Steps">
          <Points points={wf.steps} ordered />
        </Field>
        <Field label="Definition of done" wide>
          <BankText text={wf.definition_of_done} />
        </Field>
        <Field label="VA can decide">
          <Points points={wf.va_can_decide} />
        </Field>
        <Field label="Requires approval">
          <Points points={wf.requires_approval} />
        </Field>
        <Field label="Immediate escalation">
          <Points points={wf.immediate_escalation} />
        </Field>
        <Field label="Common mistakes">
          <Points points={wf.common_mistakes} />
        </Field>
        <Field label="Prohibited actions">
          <Points points={wf.prohibited_actions} tone="red" />
        </Field>
        <Field label="SOP outline (the VA writes this)">
          <Points points={wf.sop_outline} ordered />
        </Field>
        <Field label="Pass standard" wide>
          <BankText text={wf.pass_standard} />
        </Field>
        <Field label={`Office rules used (${wf.rule_keys.length})`} wide>
          <ul className="flex flex-wrap gap-1.5">
            {wf.rule_keys.map((key) => (
              <li key={key}>
                <code
                  className="rounded bg-amber-100 px-1 text-[0.9em] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                  title={ruleQuestions[key] ?? "Derived from other rules"}
                >
                  {key}
                </code>
              </li>
            ))}
          </ul>
        </Field>
        <Field label="Bank references">{wf.bank_refs.join(" · ") || "—"}</Field>
        <Field label={`Test scenarios (${wf.test_scenarios.length})`}>
          <ul className="flex flex-wrap gap-x-2 font-mono text-xs">
            {wf.test_scenarios.map((ref) => (
              <li key={ref}>
                <a href={`#${ref}`} className="underline">
                  {ref}
                </a>
              </li>
            ))}
          </ul>
        </Field>
      </dl>

      {byDay.length === 0 && (
        <p className="rounded-lg border border-foreground/15 px-4 py-3">No scenarios for this workflow yet.</p>
      )}

      {byDay.map(({ day, scenarios }) => (
        <section key={day.code} className="flex flex-col gap-2">
          <h2 className="mt-4 text-lg font-semibold">
            <span className="font-mono">{day.code}</span> · {day.title}
            <span className="ml-2 text-sm font-normal text-foreground/60">
              {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"} · day: {pointsLabel(day)}
              {day.condition !== "always" && ` · only if ${day.condition}`}
            </span>
          </h2>
          {scenarios.map((s) => (
            <ScenarioItem key={s.id} scenario={s} dayFormat={day.answer_format} />
          ))}
        </section>
      ))}
    </>
  );
}

function ScenarioItem({ scenario: s, dayFormat }: { scenario: Scenario; dayFormat: string }) {
  const cr = s.correct_response;
  return (
    <details id={`${s.schedule_day}-${s.code}`} className="scroll-mt-4 rounded-lg border border-foreground/15 px-4 py-2 open:pb-4">
      <summary className="cursor-pointer list-inside">
        <span className="font-mono font-medium">{s.code}</span>
        <span className="ml-2 text-xs text-foreground/60">
          Part {s.part}
          {s.part_title && ` (${s.part_title})`} · v{s.version} ·{" "}
          {s.type === "mc" ? "multiple choice" : "situational"} · {s.points} pt{s.points > 1 ? "s" : ""}
          {s.condition !== "always" && ` · only if ${s.condition}`}
          {s.escalation_level !== "none" && ` · ${ESCALATION_LABELS[s.escalation_level].toLowerCase()}`}
        </span>
        <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{s.stem}</p>
      </summary>

      <dl className="mt-3 grid gap-3 text-sm">
        <Field label="Scenario">
          <BankText text={s.stem} />
        </Field>

        {s.type === "mc" && s.options && (
          <Field label="Options">
            <ol className="list-[upper-alpha] pl-5">
              {s.options.map((option, i) => (
                <li key={i}>
                  <BankText text={option} />
                </li>
              ))}
            </ol>
          </Field>
        )}
        {s.type === "mc" && s.options_rule && (
          <Field label="Options (built per office)">
            <BankText text={s.options_rule} />
          </Field>
        )}
        {s.answer && (
          <Field label="Answer">
            <BankText text={s.answer} />
          </Field>
        )}

        {Array.isArray(cr) && (
          <Field label="Correct response">
            <Points points={cr} />
          </Field>
        )}
        {cr && !Array.isArray(cr) && (
          <Field label="Correct response">
            <div className="grid gap-2 sm:grid-cols-3">
              {(["Say", "Do", "Book"] as const).map((part) => (
                <div key={part}>
                  <p className="font-medium">{part}</p>
                  {cr[part].length ? <Points points={cr[part]} /> : <p className="text-foreground/50">Nothing required</p>}
                </div>
              ))}
            </div>
          </Field>
        )}

        {s.critical_fail && (
          <Field label="Critical fail">
            <span className="text-red-700 dark:text-red-400">
              <BankText text={s.critical_fail} />
            </span>
          </Field>
        )}
        <Field label="Details">
          {ESCALATION_LABELS[s.escalation_level]} · answers: {s.answer_format ?? dayFormat} · repeat variant:{" "}
          {s.repeat_variant ?? "none"} · status: {s.test_status} · source: {s.bank_ref || "—"}
        </Field>
      </dl>
    </details>
  );
}

function Points({ points, ordered, tone }: { points: string[]; ordered?: boolean; tone?: "red" }) {
  if (points.length === 0) return <p className="text-foreground/50">—</p>;
  const List = ordered ? "ol" : "ul";
  return (
    <List
      className={`${ordered ? "list-decimal" : "list-disc"} pl-5 ${tone === "red" ? "text-red-700 dark:text-red-400" : ""}`}
    >
      {points.map((point, i) => (
        <li key={i}>
          <BankText text={point} />
        </li>
      ))}
    </List>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-foreground/50">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

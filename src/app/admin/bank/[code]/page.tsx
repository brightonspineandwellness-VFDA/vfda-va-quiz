import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getWorkflowWithScenarios, type Scenario } from "@/lib/library";
import { BankText, pointsLabel } from "../bank-text";

export default function WorkflowPage({ params }: PageProps<"/admin/bank/[code]">) {
  return (
    <SignedInPage area="VFDA admin">
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
      <PageHeader
        title={
          <>
            <span className="font-mono">{wf.code}</span> · {wf.name}
          </>
        }
        description={`${scenarioCount} scenarios across ${byDay.length} training day${byDay.length === 1 ? "" : "s"} · read-only`}
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Library", href: "/admin/bank" }, { label: wf.code }]}
      />

      <Card number={1} title="Workflow">
      <dl className="grid gap-4 text-[0.9375rem] sm:grid-cols-2">
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
                  className="rounded bg-warning-soft px-1 text-[0.9em] text-warning ring-1 ring-warning/30"
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
                <a href={`#${ref}`} className="text-primary underline-offset-2 hover:underline">
                  {ref}
                </a>
              </li>
            ))}
          </ul>
        </Field>
      </dl>
      </Card>

      {byDay.length === 0 && <EmptyState title="No scenarios for this workflow yet" />}

      {byDay.map(({ day, scenarios }, n) => (
        <Card
          key={day.code}
          number={n + 2}
          title={
            <>
              <span className="font-mono">{day.code}</span> · {day.title}
            </>
          }
          description={
            <>
              {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"} · day: {pointsLabel(day)}
              {day.condition !== "always" && ` · only if ${day.condition}`}
            </>
          }
        >
          {scenarios.map((s) => (
            <ScenarioItem key={s.id} scenario={s} dayFormat={day.answer_format} />
          ))}
        </Card>
      ))}
    </>
  );
}

function ScenarioItem({ scenario: s, dayFormat }: { scenario: Scenario; dayFormat: string }) {
  const cr = s.correct_response;
  return (
    <details id={`${s.schedule_day}-${s.code}`} className="scroll-mt-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 open:pb-4">
      <summary className="cursor-pointer list-inside">
        <span className="font-mono font-semibold">{s.code}</span>{" "}
        <Badge tone="primary">{s.type === "mc" ? "Multiple choice" : "Situation"}</Badge>
        <span className="ml-2 text-xs text-muted">
          Part {s.part}
          {s.part_title && ` (${s.part_title})`} ·{" "}
          {s.type === "mc" ? "multiple choice" : "situational"} · {s.points} pt{s.points > 1 ? "s" : ""}
          {s.condition !== "always" && ` · only if ${s.condition}`}
          {s.escalation_level !== "none" && ` · ${ESCALATION_LABELS[s.escalation_level].toLowerCase()}`}
        </span>
        <p className="mt-1 line-clamp-2 text-sm text-foreground">{s.stem}</p>
      </summary>

      <dl className="mt-3 grid gap-3 border-t border-line pt-3 text-[0.9375rem]">
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
                  <p className="font-semibold">{part}</p>
                  {cr[part].length ? <Points points={cr[part]} /> : <p className="text-muted">Nothing required</p>}
                </div>
              ))}
            </div>
          </Field>
        )}

        {s.critical_fail && (
          <Field label="Critical fail">
            <span className="text-danger">
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
  if (points.length === 0) return <p className="text-muted">—</p>;
  const List = ordered ? "ol" : "ul";
  return (
    <List
      className={`${ordered ? "list-decimal" : "list-disc"} pl-5 ${tone === "red" ? "text-danger" : ""}`}
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
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

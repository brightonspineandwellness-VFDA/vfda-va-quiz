import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { dayState, KIND_LABELS, TONES } from "@/components/scenarios/day-state";
import { AutoRefresh, ScenarioEditor } from "@/components/scenarios/scenario-controls";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { approveDay, buildDay, reopenDay } from "@/lib/scenario-actions";
import { correctResponseToText, LETTERS, type CorrectResponse } from "@/lib/scenario-build";
import { loadScenarioDay, type ScenarioRow } from "@/lib/scenario-data";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_CODE = /^W\dD\d$/;

export default function ScenarioDayPage({ params }: PageProps<"/admin/offices/[id]/scenarios/[day]">) {
  return (
    <SignedInPage area="VFDA admin">
      <Suspense fallback={<Loading />}>
        <ScenarioDay params={params} />
      </Suspense>
    </SignedInPage>
  );
}

type Master = {
  stem: string;
  options: string[] | null;
  options_rule: string | null;
  answer: string | null;
  correct_response: CorrectResponse | null;
  critical_fail: string | null;
};

async function ScenarioDay({ params }: { params: Promise<{ id: string; day: string }> }) {
  await requireRole("vfda_admin");
  const { id, day } = await params;
  if (!UUID.test(id) || !DAY_CODE.test(day)) notFound();
  const data = await loadScenarioDay(id, day);
  if (!data) notFound();
  const { office, summary, rows, masters } = data;
  const state = dayState(summary);
  const approved = !!summary.status?.approved_at;
  const repeatOf = (r: ScenarioRow) => rows.find((x) => x.parent_scenario_id === r.id);

  return (
    <>
      <AutoRefresh active={summary.status?.build_status === "running"} />
      <Link href={`/admin/offices/${office.id}/scenarios`} className="text-sm text-foreground/60 hover:underline">
        ← Scenarios: {office.name}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          {summary.code}: {summary.title}
        </h1>
        <p className="text-sm text-foreground/60">{KIND_LABELS[summary.kind]}</p>
        <p className={`text-sm ${TONES[state.tone]}`}>{state.label}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {summary.status?.build_status === "done" && !approved && (
          <ActionButton action={approveDay.bind(null, office.id, day)} label="Approve day" primary />
        )}
        {approved && !summary.started && <ActionButton action={reopenDay.bind(null, office.id, day)} label="Reopen" />}
        {!summary.started && !approved && summary.status?.build_status !== "running" && (
          <ActionButton
            action={buildDay.bind(null, office.id, day)}
            label={summary.status?.build_status === "done" ? "Rebuild (replaces edits)" : "Build"}
            pendingLabel="Starting…"
          />
        )}
      </div>
      {approved && <p className="text-sm text-foreground/70">Approved days can&apos;t be edited. Reopen the day first.</p>}

      {(["A", "B"] as const).map((version) => {
        const items = rows.filter((r) => r.version === version && !r.is_repeat_variant);
        if (!items.length) return null;
        return (
          <section key={version} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              Version {version}
              {version === "B" && <span className="font-normal text-foreground/60"> · used for retakes</span>}
            </h2>
            {items.map((r) => (
              <Item
                key={r.id}
                row={r}
                master={version === "A" && r.scenario_id ? (masters.get(r.scenario_id) as Master | undefined) : undefined}
                repeat={repeatOf(r)}
                locked={approved}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}

function Item({ row, master, repeat, locked }: { row: ScenarioRow; master?: Master; repeat?: ScenarioRow; locked: boolean }) {
  const editable = (r: ScenarioRow) =>
    !locked && (
      <ScenarioEditor
        id={r.id}
        type={r.type}
        isRepeat={r.is_repeat_variant}
        initial={{
          stem: r.stem,
          options: (r.options ?? []).join("\n"),
          answer: r.answer ?? "",
          correctResponse: correctResponseToText(r.correct_response),
          criticalFail: r.critical_fail ?? "",
        }}
      />
    );
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-foreground/15 px-4 py-3">
      <p className="text-sm text-foreground/60">
        {row.code} · {row.workflow}
        {row.part_title && ` · ${row.part_title}`} · {row.type === "mc" ? "multiple choice" : "situational"} ·{" "}
        {row.points} pt{row.points === 1 ? "" : "s"}
        {row.formula && ` · formula ${row.formula}`}
        {row.edited_by_vfda && " · edited by VFDA"}
      </p>
      {row.missing_keys.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Needs office rules: {row.missing_keys.join(", ")}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {master && (
          <div className="flex flex-col gap-1 text-sm text-foreground/70">
            <p className="font-medium">Master</p>
            <p>{master.stem}</p>
            {master.options_rule && <p>Options rule: {master.options_rule}</p>}
            {master.options && <Options options={master.options} answer={master.answer} />}
          </div>
        )}
        <div className={`flex flex-col gap-1 text-sm ${master ? "" : "md:col-span-2"}`}>
          <p className="font-medium">This office</p>
          <p className="whitespace-pre-line">{row.stem}</p>
          {row.type === "mc" &&
            (row.options ? <Options options={row.options} answer={row.answer} /> : <p className="text-amber-700">No options yet</p>)}
        </div>
      </div>
      {row.type === "situational" && (
        <div className="text-sm">
          <p className="font-medium">Correct response</p>
          <pre className="whitespace-pre-wrap font-sans">{correctResponseToText(row.correct_response)}</pre>
          {row.critical_fail && (
            <p>
              <span className="font-medium">Critical fail:</span> {row.critical_fail}
            </p>
          )}
        </div>
      )}
      {editable(row)}
      {row.type === "situational" && (
        <div className="flex flex-col gap-1 border-t border-foreground/10 pt-2 text-sm">
          <p className="font-medium">Repeat variant</p>
          {repeat ? (
            <>
              <p className="whitespace-pre-line">{repeat.stem}</p>
              {editable(repeat)}
            </>
          ) : (
            <p className="text-foreground/60">None. A VA who misses this item goes to VFDA review instead.</p>
          )}
        </div>
      )}
    </article>
  );
}

function Options({ options, answer }: { options: string[]; answer: string | null }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {options.map((o, i) => (
        <li key={i} className={LETTERS[i] === answer ? "font-medium text-green-700 dark:text-green-400" : ""}>
          {LETTERS[i]}) {o}
          {LETTERS[i] === answer && " ✓"}
        </li>
      ))}
    </ol>
  );
}

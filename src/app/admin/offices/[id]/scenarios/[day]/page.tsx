import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { dayState, KIND_LABELS, TONES } from "@/components/scenarios/day-state";
import { Blanks, RuleAnswerBox } from "@/components/scenarios/missing-rules";
import { AutoRefresh, ScenarioEditor } from "@/components/scenarios/scenario-controls";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { approveDay, buildDay, regenerateScenario, removeScenario, reopenDay } from "@/lib/scenario-actions";
import { ITEM_TYPE_LABELS } from "@/lib/day-rules";
import { correctResponseToText, LETTERS, type CorrectResponse } from "@/lib/scenario-build";
import { loadScenarioDay, rebuildNote, type MissingRule, type ScenarioRow } from "@/lib/scenario-data";

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
  const { office, summary, rows, masters, missing } = data;
  const state = dayState(summary);
  const approved = summary.approved;
  const repeatOf = (r: ScenarioRow) => rows.find((x) => x.parent_scenario_id === r.id);
  const items = rows.filter((r) => r.version === "A" && !r.is_repeat_variant);
  const note = rebuildNote(summary);
  const built = summary.status?.build_status === "done";
  const review = items.filter((r) => r.test_status === "needs_review");
  const item = (r: ScenarioRow) => (
    <Item
      key={r.id}
      row={r}
      master={r.scenario_id ? (masters.get(r.scenario_id) as Master | undefined) : undefined}
      repeat={repeatOf(r)}
      locked={approved}
      officeId={office.id}
      missing={missing.filter((m) => r.missing_keys.includes(m.key))}
    />
  );

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
        <p className="text-sm text-foreground/60">
          {KIND_LABELS[summary.kind]}
          {summary.status?.build_version ? ` · version ${summary.status.build_version}` : ""}
        </p>
        <p className={`text-sm ${TONES[state.tone]}`}>{state.label}</p>
        {summary.kind !== "skipped" && (
          <p className="text-sm text-foreground/60">
            {summary.cards.length ? `Written from: ${summary.cards.join(", ")}` : "No card mapped to this day: built from the master bank."}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {built && !approved && (
          <ActionButton action={approveDay.bind(null, office.id, day)} label="Approve day" primary disabled={review.length > 0} />
        )}
        {approved && !summary.liveTaken && <ActionButton action={reopenDay.bind(null, office.id, day)} label="Reopen" />}
        {summary.status?.build_status !== "running" && (
          <ActionButton
            action={buildDay.bind(null, office.id, day)}
            label={built ? `Rebuild (new version ${(summary.status?.build_version ?? 0) + 1})` : "Build"}
            pendingLabel="Starting…"
          />
        )}
      </div>
      {note && <p className="text-sm text-amber-700 dark:text-amber-300">{note}</p>}
      {approved && (
        <p className="text-sm text-foreground/70">
          {summary.liveTaken
            ? "A live version a VA has taken can't be edited. Rebuild to make a new version."
            : "Approved days can't be edited. Reopen the day first."}
        </p>
      )}

      {missing.length > 0 && !approved && (
        <section className="flex flex-col gap-3 rounded-lg border-2 border-amber-600/60 p-3 dark:border-amber-400/60">
          <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300">
            {missing.length} office rule{missing.length > 1 ? "s" : ""} missing
          </h2>
          <p className="text-sm">
            Type the office&rsquo;s answer: it&rsquo;s saved as an accepted rule and fills every scenario of this office that
            uses it, without a rebuild.
          </p>
          <ul className="flex flex-col gap-3">
            {missing.map((m) => (
              <li key={m.key} className="flex flex-col gap-1">
                <RuleAnswerBox officeId={office.id} rule={m} />
                <span className="text-xs text-foreground/60">Used by {m.items.join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border-2 border-red-700/60 p-3 dark:border-red-400/60">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
            {review.length} item{review.length > 1 ? "s" : ""} need{review.length > 1 ? "" : "s"} review
          </h2>
          <p className="text-sm">
            These still failed a check after Claude rewrote them twice. Edit, regenerate or remove each one; the day can be approved
            once none are left. Every failed check is on the{" "}
            <Link href="/admin/logs" className="underline">
              System log
            </Link>
            .
          </p>
          {review.map(item)}
        </section>
      )}

      {items.length > review.length && (
        <section className="flex flex-col gap-3">{items.filter((r) => r.test_status !== "needs_review").map(item)}</section>
      )}
    </>
  );
}

function Item({
  row,
  master,
  repeat,
  locked,
  officeId,
  missing,
}: {
  row: ScenarioRow;
  master?: Master;
  repeat?: ScenarioRow;
  locked: boolean;
  officeId: string;
  missing: MissingRule[];
}) {
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
  const needsReview = row.test_status === "needs_review";
  return (
    <article
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${needsReview ? "border-red-700/60 bg-red-50 dark:border-red-400/60 dark:bg-red-950/40" : "border-foreground/15"}`}
    >
      {needsReview && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">Needs review: {row.review_error ?? "failed a check"}</p>
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <ActionButton action={regenerateScenario.bind(null, row.id)} label="Regenerate" pendingLabel="Regenerating…" />
              <ActionButton action={removeScenario.bind(null, row.id)} label="Remove" pendingLabel="Removing…" />
              <span className="self-center text-sm text-foreground/60">or Edit below</span>
            </div>
          )}
        </div>
      )}
      <p className="text-sm text-foreground/60">
        {row.code} · {row.workflow}
        {row.part_title && ` · ${row.part_title}`} · {ITEM_TYPE_LABELS[row.type]} ·{" "}
        {row.points} pt{row.points === 1 ? "" : "s"}
        {row.formula && ` · formula ${row.formula}`}
        {row.edited_by_vfda && " · edited by VFDA"}
      </p>
      {row.missing_keys.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-600/50 p-2 dark:border-amber-400/50">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Needs office rules: {row.missing_keys.map((k) => `{${k}}`).join(", ")}
          </p>
          {!locked && (
            <>
              {missing.map((m) => (
                <RuleAnswerBox key={m.key} officeId={officeId} rule={m} />
              ))}
              <div>
                <ActionButton action={removeScenario.bind(null, row.id)} label="Remove from this office" pendingLabel="Removing…" />
              </div>
            </>
          )}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {row.source_card && (
          <div className="flex flex-col gap-1 rounded-md bg-foreground/5 px-3 py-2 text-sm md:order-last">
            <p className="font-medium">Source: {row.source_card}</p>
            {row.source_quote && <blockquote className="whitespace-pre-line text-foreground/70">&ldquo;{row.source_quote}&rdquo;</blockquote>}
          </div>
        )}
        {!row.source_card && master && (
          <div className="flex flex-col gap-1 text-sm text-foreground/70">
            <p className="font-medium">Master</p>
            <p>{master.stem}</p>
            {master.options_rule && <p>Options rule: {master.options_rule}</p>}
            {master.options && <Options options={master.options} answer={master.answer} />}
          </div>
        )}
        <div className={`flex flex-col gap-1 text-sm ${master || row.source_card ? "" : "md:col-span-2"}`}>
          <p className="font-medium">This office</p>
          <p className="whitespace-pre-line">
            <Blanks text={row.stem} />
          </p>
          {row.type === "mc" &&
            (row.options ? <Options options={row.options} answer={row.answer} /> : <p className="text-amber-700 dark:text-amber-300">No options yet</p>)}
        </div>
      </div>
      {row.type === "describe" && (
        <div className="text-sm">
          <p className="font-medium">Key points (graded 0–2 on the VA&rsquo;s own words; no repeat)</p>
          <pre className="whitespace-pre-wrap font-sans">
            <Blanks text={correctResponseToText(row.correct_response)} />
          </pre>
        </div>
      )}
      {row.type === "situational" && (
        <div className="text-sm">
          <p className="font-medium">Correct response</p>
          <pre className="whitespace-pre-wrap font-sans">
            <Blanks text={correctResponseToText(row.correct_response)} />
          </pre>
          {row.critical_fail && (
            <p>
              <span className="font-medium">Critical fail:</span> <Blanks text={row.critical_fail} />
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
            <p className="text-foreground/60">
              None{needsReview ? " yet: one is written once the item passes" : ". A VA who misses this item gets no repeat"}.
            </p>
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
          {LETTERS[i]}) <Blanks text={o} />
          {LETTERS[i] === answer && " ✓"}
        </li>
      ))}
    </ol>
  );
}

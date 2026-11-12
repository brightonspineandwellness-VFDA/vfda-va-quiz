import Link from "next/link";
import { Blanks } from "@/components/scenarios/missing-rules";
import { ScenarioEditor } from "@/components/scenarios/scenario-controls";
import { ActionButton } from "@/components/setup/action-button";
import { buttonClass, Card, EmptyState, linkClass, StatusBadge } from "@/components/ui";
import { BANK_STATUS_LABELS, filterBank, type BankFilters, type BankItem } from "@/lib/bank-export";
import { setShareAnswerBank } from "@/lib/bank-actions";
import { ITEM_TYPE_LABELS } from "@/lib/day-rules";
import { approveDay, regenerateScenario, removeScenario } from "@/lib/scenario-actions";
import type { Bank } from "@/lib/scenario-bank";
import { correctResponseToText, LETTERS } from "@/lib/scenario-build";

// The scenario bank with answers. `admin`: edit, approve and sharing (VFDA);
// otherwise read-only (the office's doctors, when shared). Never for VAs.
export function BankView({
  bank,
  filters,
  admin,
  pagePath,
  exportPath,
}: {
  bank: Bank;
  filters: BankFilters;
  admin: boolean;
  pagePath: string;
  exportPath: string;
}) {
  const shown = filterBank(bank.items, filters);
  const select = "w-full";
  const download = (format: "pdf" | "csv", day?: string) => `${exportPath}?format=${format}${day ? `&day=${day}` : ""}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href={download("pdf")} className={buttonClass("primary")} download>
          Download PDF (whole office)
        </a>
        <a href={download("csv")} className={buttonClass("secondary")} download>
          Download CSV (whole office)
        </a>
        {admin && (
          <span className="flex items-center gap-2">
            <span className="text-muted">Share answer bank with doctor: {bank.office.share_answer_bank ? "on" : "off"}</span>
            <ActionButton
              action={setShareAnswerBank.bind(null, bank.office.id, !bank.office.share_answer_bank)}
              label={bank.office.share_answer_bank ? "Stop sharing" : "Share with doctor"}
            />
          </span>
        )}
      </div>

      <form
        method="get"
        action={pagePath}
        className="grid grid-cols-1 items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.06)] sm:grid-cols-2 lg:grid-cols-4 sm:px-6"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Day</span>
          <select name="day" defaultValue={filters.day ?? ""} className={select}>
            <option value="">All days</option>
            {bank.days.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} {d.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Type</span>
          <select name="type" defaultValue={filters.type ?? ""} className={select}>
            <option value="">All types</option>
            <option value="mc">Multiple choice</option>
            <option value="situational">Situational</option>
            <option value="describe">Describe</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Card</span>
          <select name="card" defaultValue={filters.card ?? ""} className={select}>
            <option value="">All cards</option>
            <option value="(none)">No card (master bank)</option>
            {bank.cards.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Status</span>
          <select name="status" defaultValue={filters.status ?? ""} className={select}>
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="needs_review">Needs review</option>
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="review" value="1" defaultChecked={!!filters.review} />
          Needs review
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-2">
          <span className="text-sm font-semibold">Search</span>
          <input name="q" defaultValue={filters.q ?? ""} placeholder="Words in the question, answer or card" className={select} />
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass("primary")}>
            Filter
          </button>
          <Link href={pagePath} className={linkClass}>
            Clear
          </Link>
        </div>
      </form>

      <p className="text-sm text-muted">
        {shown.length} of {bank.items.length} scenario(s). Answer key: never shown to VAs.
      </p>

      {bank.days
        .filter((d) => shown.some((i) => i.day === d.code))
        .map((d) => {
          const items = shown.filter((i) => i.day === d.code);
          const latestReview = d.items.some((i) => i.build_version === d.latest && i.status === "needs_review");
          return (
            <Card
              key={d.code}
              title={`${d.code}: ${d.title}`}
              description={
                <>
                  {d.latest ? `version ${d.latest}` : ""}
                  {d.approved ? " · approved" : d.live ? ` · version ${d.live} approved` : " · not approved"}
                </>
              }
              actions={
                <>
                  <a href={download("pdf", d.code)} className={buttonClass("secondary", "sm")} download>
                    PDF
                  </a>
                  <a href={download("csv", d.code)} className={buttonClass("secondary", "sm")} download>
                    CSV
                  </a>
                  {admin && (
                    <Link href={`/admin/offices/${bank.office.id}/scenarios/${d.code}`} className={buttonClass("secondary", "sm")}>
                      Day review
                    </Link>
                  )}
                  {admin && d.latest && !d.approved && (
                    <ActionButton action={approveDay.bind(null, bank.office.id, d.code)} label={`Approve ${d.code}`} disabled={latestReview} />
                  )}
                </>
              }
            >
              <ol className="flex flex-col gap-3">
                {items.map((i) => (
                  <li key={i.id}>
                    <BankEntry item={i} admin={admin && i.build_version === d.latest && i.status !== "approved"} />
                  </li>
                ))}
              </ol>
            </Card>
          );
        })}
      {!shown.length && <EmptyState title="No scenarios match">Try a different filter, or press Clear.</EmptyState>}
    </>
  );
}

function BankEntry({ item, admin }: { item: BankItem; admin: boolean }) {
  return (
    <article
      className={`flex flex-col gap-2 rounded-[var(--radius-card)] border bg-surface px-4 py-3 text-[0.9375rem] ${item.status === "needs_review" ? "border-l-4 border-danger" : "border-line"}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{item.code}</span>
        <span className="text-sm text-muted">
          {ITEM_TYPE_LABELS[item.type]} · {item.points} pt{item.points === 1 ? "" : "s"} · {item.workflow} · version {item.build_version}
        </span>
        <StatusBadge label={BANK_STATUS_LABELS[item.status]} />
      </div>
      {item.status === "needs_review" && item.review_error && <p className="text-danger">Needs review: {item.review_error}</p>}
      <p className="whitespace-pre-line">
        <Blanks text={item.stem} />
      </p>
      {item.options && (
        <ol className="flex flex-col gap-0.5">
          {item.options.map((o, n) => (
            <li key={n} className={LETTERS[n] === item.answer ? "font-medium text-success" : ""}>
              {LETTERS[n]}) <Blanks text={o} />
              {LETTERS[n] === item.answer && " ✓ correct"}
            </li>
          ))}
        </ol>
      )}
      {item.type !== "mc" && item.correct_response && (
        <div>
          <p className="font-medium">{item.type === "describe" ? "Key points" : "Correct response / required steps"}</p>
          <pre className="font-sans whitespace-pre-wrap">
            <Blanks text={correctResponseToText(item.correct_response)} />
          </pre>
        </div>
      )}
      {item.critical_fail && (
        <p>
          <span className="font-medium text-danger">Critical fail:</span> {item.critical_fail}
        </p>
      )}
      {item.source_card && (
        <p className="text-muted">
          Source: <span className="font-medium">{item.source_card}</span>
          {item.source_quote && <> &ldquo;{item.source_quote}&rdquo;</>}
        </p>
      )}
      {item.repeat && <p className="text-muted">Repeat variant: {item.repeat.stem}</p>}
      {item.retakes.map((r, n) => (
        <p key={n} className="text-muted">
          Retake version: {r}
        </p>
      ))}
      {admin && (
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          {item.status === "needs_review" && (
            <div className="flex flex-wrap gap-2">
              <ActionButton action={regenerateScenario.bind(null, item.id)} label="Regenerate" pendingLabel="Regenerating…" />
              <ActionButton action={removeScenario.bind(null, item.id)} label="Remove" pendingLabel="Removing…" />
            </div>
          )}
          <ScenarioEditor
            id={item.id}
            type={item.type}
            isRepeat={false}
            initial={{
              stem: item.stem,
              options: (item.options ?? []).join("\n"),
              answer: item.answer ?? "",
              correctResponse: correctResponseToText(item.correct_response),
              criticalFail: item.critical_fail ?? "",
            }}
          />
        </div>
      )}
    </article>
  );
}

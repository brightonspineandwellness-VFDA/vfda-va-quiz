import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/setup/action-button";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ProofReview, StartDateForm } from "@/components/va/proof-review";
import { requireRole } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";
import { decideReviewDay } from "@/lib/va-admin-actions";
import { PROOF_BUCKET } from "@/lib/va-training";

export default function VasPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">VA training</h1>
      <Suspense fallback={<Loading />}>
        <Vas />
      </Suspense>
    </SignedInPage>
  );
}

const STATUS_LABELS: Record<string, string> = {
  locked: "locked",
  open: "open",
  submitted: "grading",
  passed: "passed",
  in_review: "in review",
  retake: "retake",
};

const minutes = (s: number | null) => (s === null ? "–" : `${Math.max(1, Math.round(s / 60))} min`);

async function Vas() {
  await requireRole("vfda_admin");
  const supabase = await createSessionClient();
  const [vas, offices, sequence, unlocks, attempts, proofs] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, office_id, va_start_date").eq("role", "va").order("full_name"),
    supabase.from("offices").select("id, name"),
    supabase.from("settings").select("value").eq("key", "sequence").maybeSingle(),
    supabase.from("day_unlocks").select("va_id, schedule_day, version, status, cards_done_at, opens_on"),
    supabase
      .from("attempts")
      .select("id, va_id, schedule_day, version, submitted_at, first_try_points, max_points, result, critical_errors, time_spent, paste_log, fast_finish")
      .not("submitted_at", "is", null)
      .order("submitted_at"),
    supabase
      .from("proof_uploads")
      .select("id, va_id, schedule_day, file_path, file_name, link_url, status, review_note, created_at")
      .order("created_at"),
  ]);
  const attemptRows = attempts.data ?? [];
  const { data: items } = attemptRows.length
    ? await supabase
        .from("attempt_items")
        .select("attempt_id, fast, ai_confidence, first_score, repeat_score, repeat_scenario_id")
        .in(
          "attempt_id",
          attemptRows.map((a) => a.id),
        )
    : { data: [] };
  const filePaths = (proofs.data ?? []).map((p) => p.file_path).filter((p): p is string => !!p);
  const { data: signed } = filePaths.length
    ? await supabase.storage.from(PROOF_BUCKET).createSignedUrls(filePaths, 3600)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const officeName = new Map((offices.data ?? []).map((o) => [o.id, o.name]));
  const order = ((sequence.data?.value as string[] | undefined) ?? []).reduce<Record<string, number>>(
    (m, code, i) => ({ ...m, [code]: i }),
    {},
  );

  if (!vas.data?.length) return <p className="text-foreground/70">No VAs yet.</p>;

  return (
    <>
      {vas.data.map((va) => {
        const days = (unlocks.data ?? [])
          .filter((u) => u.va_id === va.id)
          .sort((a, b) => (order[a.schedule_day] ?? 99) - (order[b.schedule_day] ?? 99));
        const mine = attemptRows.filter((a) => a.va_id === va.id);
        const proofRows = (proofs.data ?? []).filter((p) => p.va_id === va.id);
        return (
          <section key={va.id} className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
            <div>
              <h2 className="text-lg font-semibold">{va.full_name || va.email}</h2>
              <p className="text-sm text-foreground/60">
                {va.email} · {va.office_id ? (officeName.get(va.office_id) ?? "Unknown office") : "No office"}
              </p>
            </div>
            <StartDateForm vaId={va.id} value={va.va_start_date} />

            <p className="text-sm">
              <span className="font-medium">Days: </span>
              {days.length
                ? days
                    .map(
                      (d) =>
                        `${d.schedule_day} ${STATUS_LABELS[d.status] ?? d.status}${d.version === "B" ? " (B)" : ""}${
                          d.status === "locked" && d.cards_done_at ? ", cards done" : ""
                        }`,
                    )
                    .join(" · ")
                : "not started"}
            </p>

            {days
              .filter((d) => d.status === "in_review")
              .map((d) => (
                <div key={d.schedule_day} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {d.schedule_day}
                    {d.version === "B" ? " version B: failed the retake, call the VA" : " is waiting for your review"}
                  </span>
                  <ActionButton action={decideReviewDay.bind(null, va.id, d.schedule_day, "pass")} label="Approve" primary />
                  {d.version === "A" && (
                    <ActionButton
                      action={decideReviewDay.bind(null, va.id, d.schedule_day, "retake")}
                      label="Assign retake (version B)"
                    />
                  )}
                </div>
              ))}

            {mine.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-foreground/15 text-foreground/60">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Day</th>
                      <th className="py-1 pr-3 font-medium">First try</th>
                      <th className="py-1 pr-3 font-medium">Result</th>
                      <th className="py-1 pr-3 font-medium">Time</th>
                      <th className="py-1 pr-3 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((a) => {
                      const its = (items ?? []).filter((i) => i.attempt_id === a.id);
                      const repeats = its.filter((i) => i.repeat_scenario_id);
                      const flags = [
                        a.fast_finish && "fast finish",
                        its.some((i) => i.fast) && `${its.filter((i) => i.fast).length} fast items`,
                        a.critical_errors > 0 && `${a.critical_errors} critical`,
                        Array.isArray(a.paste_log) && a.paste_log.length > 0 && `${a.paste_log.length} pastes`,
                        repeats.length > 0 &&
                          `${repeats.length} repeated (${repeats.filter((i) => i.repeat_score !== 2).length} still below 2/2)`,
                        its.some((i) => i.ai_confidence !== null && Number(i.ai_confidence) < 0.7) && "low-confidence grade",
                        its.some((i) => i.first_score === null) && "ungraded item",
                      ].filter(Boolean);
                      return (
                        <tr key={a.id} className="border-b border-foreground/10 align-top">
                          <td className="py-1 pr-3">
                            {a.schedule_day}
                            {a.version === "B" && " (B)"}
                          </td>
                          <td className="py-1 pr-3">
                            {Number(a.first_try_points)}/{a.max_points}
                          </td>
                          <td className="py-1 pr-3">{a.result}</td>
                          <td className="py-1 pr-3">{minutes(a.time_spent)}</td>
                          <td className="py-1 pr-3">{flags.join(", ") || "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {proofRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">Proof of work</h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {proofRows.map((p) => {
                    const href = p.link_url ?? (p.file_path ? urlOf.get(p.file_path) : undefined);
                    return (
                      <li key={p.id} className="flex flex-col gap-1">
                        <span>
                          {p.schedule_day} ·{" "}
                          {href ? (
                            <a href={href} target="_blank" rel="noreferrer" className="underline">
                              {p.link_url ?? p.file_name ?? "file"}
                            </a>
                          ) : (
                            (p.file_name ?? "file")
                          )}{" "}
                          · {p.status}
                          {p.review_note && ` · "${p.review_note}"`}
                        </span>
                        {p.status === "pending" && <ProofReview proofId={p.id} />}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

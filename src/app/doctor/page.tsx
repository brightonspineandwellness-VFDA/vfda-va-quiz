import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ButtonLink, Card, EmptyState, linkClass, PageHeader, StatusBadge, Table, td, th, thNum, tdNum } from "@/components/ui";
import { StepProgress } from "@/components/setup/step-progress";
import { requireRole } from "@/lib/auth";
import { currentStep } from "@/lib/doctor-flow";
import { loadOfficeSetup } from "@/lib/interview-data";
import { TREND_LABELS } from "@/lib/report";
import { canReadBank } from "@/lib/scenario-bank";
import { createSessionClient } from "@/lib/supabase/server";
import { attemptLabel, percentOf, resultLabel, trend } from "@/lib/va-flow";

export default function DoctorPage() {
  return (
    <SignedInPage area="Doctor">
      <Suspense fallback={<Loading />}>
        <DoctorHome />
      </Suspense>
    </SignedInPage>
  );
}

async function DoctorHome() {
  const user = await requireRole("doctor");
  const setup = user.officeId ? await loadOfficeSetup(user.officeId) : null;
  const next = setup && currentStep(setup.flow.steps)?.step;
  // The scenario bank with answers, only when VFDA shared it.
  const bankShared = !!user.officeId && (await canReadBank(user, user.officeId));

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.fullName || user.email}`}
        description={`Office: ${setup?.interview.office.name ?? "not found"}`}
        actions={
          setup && (
            <ButtonLink href={next?.href ?? "/doctor/setup"} variant="primary">
              {next ? `Continue: ${next.label}` : "Office setup"}
            </ButtonLink>
          )
        }
      />
      {setup && <StepProgress steps={setup.flow.steps} />}
      <Card title="Your VA" description="Training progress, workflow certifications and Trello card tips.">
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/doctor/va">My VA: workflow certifications and Trello cards</ButtonLink>
          {bankShared && <ButtonLink href="/doctor/bank">Scenario bank with answers (shared by VFDA)</ButtonLink>}
        </div>
      </Card>
      <Results />
    </>
  );
}

// The office's VAs' finished training days, newest first.
async function Results() {
  const supabase = await createSessionClient();
  const { data: attempts } = await supabase
    .from("attempts")
    .select("id, va_id, kind, schedule_day, first_try_points, max_points, result, submitted_at")
    .not("submitted_at", "is", null)
    .is("archived_at", null)
    .order("submitted_at", { ascending: false })
    .limit(50);
  if (!attempts?.length)
    return (
      <Card title="VA training results">
        <EmptyState title="No finished training days yet">Your VA&apos;s results show here after each quiz.</EmptyState>
      </Card>
    );
  const { data: vas } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", [...new Set(attempts.map((a) => a.va_id))]);
  const name = new Map((vas ?? []).map((v) => [v.id, v.full_name || v.email]));
  // Each VA's trend across their training days (oldest first).
  const trends = [...name.keys()].map((id) => {
    const days = attempts.filter((a) => a.va_id === id && a.kind === "day").reverse();
    const t = trend(days.map((a) => percentOf(a.first_try_points, a.max_points)));
    return { id, text: t ? TREND_LABELS[t] : null };
  });
  return (
    <Card title="VA training results" description="Finished training days, newest first.">
      {trends
        .filter((t) => t.text)
        .map((t) => (
          <p key={t.id} className="text-[0.9375rem]">
            <span className="font-semibold">{name.get(t.id)}</span>: first-try scores {t.text?.toLowerCase()} across days.
          </p>
        ))}
      <Table>
        <thead>
          <tr>
            <th className={th}>VA · day</th>
            <th className={thNum}>Score</th>
            <th className={th}>Result</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id}>
              <td className={td}>
                <Link href={`/doctor/attempts/${a.id}`} className={linkClass}>
                  {name.get(a.va_id) ?? "Former VA"} · {attemptLabel(a)}
                </Link>
              </td>
              <td className={tdNum}>
                {Number(a.first_try_points)}/{a.max_points} ({percentOf(a.first_try_points, a.max_points)}%)
              </td>
              <td className={td}>{a.result ? <StatusBadge label={resultLabel(a.result)} /> : "–"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

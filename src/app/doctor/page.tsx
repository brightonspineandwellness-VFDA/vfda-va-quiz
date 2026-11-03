import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { StepProgress } from "@/components/setup/step-progress";
import { requireRole } from "@/lib/auth";
import { currentStep } from "@/lib/doctor-flow";
import { loadOfficeSetup } from "@/lib/interview-data";
import { TREND_LABELS } from "@/lib/report";
import { createSessionClient } from "@/lib/supabase/server";
import { percentOf, resultLabel, trend } from "@/lib/va-flow";

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

  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome, {user.fullName || user.email}</h1>
      <p>Office: {setup?.interview.office.name ?? "not found"}</p>
      {setup && (
        <>
          <StepProgress steps={setup.flow.steps} />
          <Link
            href={next?.href ?? "/doctor/setup"}
            className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background"
          >
            {next ? `Continue: ${next.label}` : "Office setup"}
          </Link>
        </>
      )}
      <Link href="/doctor/va" className="self-start underline">
        My VA: workflow certifications and Trello cards
      </Link>
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
  if (!attempts?.length) return null;
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
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">VA training results</h2>
      {trends
        .filter((t) => t.text)
        .map((t) => (
          <p key={t.id} className="text-sm">
            {name.get(t.id)}: first-try scores {t.text?.toLowerCase()} across days.
          </p>
        ))}
      <ul className="flex flex-col gap-1 text-sm">
        {attempts.map((a) => (
          <li key={a.id}>
            <Link href={`/doctor/attempts/${a.id}`} className="underline">
              {name.get(a.va_id) ?? "Former VA"} · {a.kind === "day" ? a.schedule_day : "Recheck"}
            </Link>{" "}
            · {Number(a.first_try_points)}/{a.max_points} ({percentOf(a.first_try_points, a.max_points)}%) · {resultLabel(a.result)}
          </li>
        ))}
      </ul>
    </section>
  );
}

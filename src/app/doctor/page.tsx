import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { StepProgress } from "@/components/setup/step-progress";
import { requireRole } from "@/lib/auth";
import { currentStep } from "@/lib/doctor-flow";
import { loadOfficeSetup } from "@/lib/interview-data";
import { RESULT_LABELS } from "@/lib/report";
import { createSessionClient } from "@/lib/supabase/server";

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
    .select("id, va_id, schedule_day, version, first_try_points, max_points, result, submitted_at")
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(50);
  if (!attempts?.length) return null;
  const { data: vas } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", [...new Set(attempts.map((a) => a.va_id))]);
  const name = new Map((vas ?? []).map((v) => [v.id, v.full_name || v.email]));
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">VA training results</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {attempts.map((a) => (
          <li key={a.id}>
            <Link href={`/doctor/attempts/${a.id}`} className="underline">
              {name.get(a.va_id) ?? "VA"} · {a.schedule_day}
              {a.version === "B" && " (B)"}
            </Link>{" "}
            · {Number(a.first_try_points)}/{a.max_points} ·{" "}
            {RESULT_LABELS[a.result as keyof typeof RESULT_LABELS]?.split(" (")[0] ?? a.result}
          </li>
        ))}
      </ul>
    </section>
  );
}

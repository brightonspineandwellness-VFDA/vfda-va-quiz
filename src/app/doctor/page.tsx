import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { StepProgress } from "@/components/setup/step-progress";
import { requireRole } from "@/lib/auth";
import { loadOfficeSetup } from "@/lib/interview-data";

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
  const next = setup?.flow.steps.find((s) => s.state === "todo");

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
    </>
  );
}

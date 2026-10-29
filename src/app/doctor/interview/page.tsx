import Link from "next/link";
import { Suspense } from "react";
import { InterviewForm } from "@/components/interview/interview-form";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { loadInterview } from "@/lib/interview-data";

export default function DoctorInterviewPage() {
  return (
    <SignedInPage area="Doctor">
      <Link href="/doctor" className="text-sm text-foreground/60 hover:underline">
        ← Home
      </Link>
      <Suspense fallback={<Loading />}>
        <DoctorInterview />
      </Suspense>
    </SignedInPage>
  );
}

async function DoctorInterview() {
  const user = await requireRole("doctor");
  // A doctor's setup is always their own office's; there's no id in the URL to change.
  const data = user.officeId ? await loadInterview(user.officeId) : null;
  if (!data) return <p>Your office isn&apos;t set up yet. Contact VFDA.</p>;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Office setup: {data.office.name}</h1>
        <p className="text-foreground/70">
          Everything saves as you type. You can leave and come back any time.
        </p>
      </div>
      <InterviewForm data={data} isAdmin={false} />
    </>
  );
}

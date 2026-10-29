import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { getCurrentUser } from "@/lib/auth";
import { homeFor } from "@/lib/roles";

export default function PendingPage() {
  return (
    <SignedInPage area="Waiting for access">
      <Suspense fallback={<Loading />}>
        <Pending />
      </Suspense>
    </SignedInPage>
  );
}

async function Pending() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role) redirect(homeFor(user.role));

  return (
    <>
      <h1 className="text-2xl font-semibold">You&apos;re signed in</h1>
      <p>
        {user.email} doesn&apos;t have access yet. VFDA will set up your account, then sign in
        again.
      </p>
    </>
  );
}

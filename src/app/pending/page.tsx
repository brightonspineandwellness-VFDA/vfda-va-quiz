import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Notice, PageHeader } from "@/components/ui";
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
      <PageHeader title="You're signed in" description="Your account is waiting for access." />
      <Notice tone="info" title="No access yet">
        <p>
          {user.email} doesn&apos;t have access yet. VFDA will set up your account, then sign in
          again.
        </p>
      </Notice>
    </>
  );
}

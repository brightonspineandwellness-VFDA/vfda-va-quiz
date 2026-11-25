import { Suspense } from "react";
import { CallScreen } from "@/components/calls/call-screen";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { ACCESS_MESSAGES, callAccess } from "@/lib/call-practice/access";
import { CALL_TYPE_LABELS, CALL_TYPES, isRoleplayFor, ROLEPLAY_TITLES } from "@/lib/call-practice/types";

export default function NewCallPage({ searchParams }: PageProps<"/va/calls/new">) {
  return (
    <SignedInPage area="VA">
      <PageHeader
        title="Practice call"
        breadcrumbs={[
          { label: "Today", href: "/va" },
          { label: "Call practice", href: "/va/calls" },
          { label: "Practice call" },
        ]}
      />
      <Suspense fallback={<Loading />}>
        <NewCall searchParams={searchParams} />
      </Suspense>
    </SignedInPage>
  );
}

async function NewCall({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("va");
  const access = await callAccess(user);
  if (!access.allowed) {
    return (
      <Notice tone="info" title="Call practice isn't available">
        <p>{ACCESS_MESSAGES[access.reason]}</p>
      </Notice>
    );
  }
  const { type, roleplay } = await searchParams;
  const callType = CALL_TYPES.find((t) => t === type);
  if (!callType || ((callType === "w2d1_roleplay" || callType === "w2d2_roleplay") && !isRoleplayFor(callType, String(roleplay ?? "")))) {
    return (
      <Notice tone="warning" title="Pick a call first">
        <ButtonLink href="/va/calls" variant="primary">
          Back to Call practice
        </ButtonLink>
      </Notice>
    );
  }
  const rp = isRoleplayFor(callType, String(roleplay ?? "")) ? (String(roleplay) as keyof typeof ROLEPLAY_TITLES) : null;
  const title = rp ? `${CALL_TYPE_LABELS[callType]}: ${ROLEPLAY_TITLES[rp]}` : CALL_TYPE_LABELS[callType];
  return <CallScreen callType={callType} roleplay={rp} title={title} />;
}

import { ButtonLink } from "@/components/ui";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { callAccess, loadCallSettings, officeHasCallPractice } from "@/lib/call-practice/access";

// "Call practice" button for the doctor's My VA page, when their office has it.
export async function DoctorCallPracticeLink() {
  try {
    const user = await getCurrentUser();
    if (user?.role !== "doctor" || !user.officeId) return null;
    if (!(await officeHasCallPractice(user.officeId, await loadCallSettings()))) return null;
  } catch {
    return null;
  }
  return <ButtonLink href="/doctor/calls">Call practice</ButtonLink>;
}

// "Call practice" button for the VA's Today page. Renders nothing unless Call
// practice is on for this VA (global switch, pilot office, Phones role), and
// never throws: a problem here must not affect the quiz page around it.
export async function CallPracticeLink({ user }: { user: CurrentUser }) {
  try {
    const access = await callAccess(user);
    if (!access.allowed) return null;
  } catch {
    return null;
  }
  return <ButtonLink href="/va/calls">Call practice</ButtonLink>;
}

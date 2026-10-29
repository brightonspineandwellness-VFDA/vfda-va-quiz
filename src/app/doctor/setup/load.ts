import "server-only";

import { requireRole } from "@/lib/auth";
import { loadOfficeSetup } from "@/lib/interview-data";

// A doctor's setup is always their own office's; there's no id in the URL to change.
export async function loadDoctorSetup() {
  const user = await requireRole("doctor");
  return user.officeId ? loadOfficeSetup(user.officeId) : null;
}

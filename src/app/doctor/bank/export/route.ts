import { getCurrentUser } from "@/lib/auth";
import { bankDownload } from "@/lib/bank-download";
import { canReadBank } from "@/lib/scenario-bank";

// The doctor's own office's scenario bank, when VFDA shared it (read-only).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (user?.role !== "doctor" || !user.officeId || !(await canReadBank(user, user.officeId))) {
    return new Response("Not allowed.", { status: 403 });
  }
  return bankDownload(user.officeId, new URL(request.url));
}

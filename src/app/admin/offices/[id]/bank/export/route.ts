import { getCurrentUser } from "@/lib/auth";
import { bankDownload } from "@/lib/bank-download";
import { canReadBank } from "@/lib/scenario-bank";

// The office's scenario bank as PDF or CSV (?format=csv, ?day=W1D1). VFDA admins.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found.", { status: 404 });
  if (!(await canReadBank(await getCurrentUser(), id))) return new Response("Not allowed.", { status: 403 });
  return bankDownload(id, new URL(request.url));
}

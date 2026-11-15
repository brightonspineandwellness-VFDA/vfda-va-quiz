import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { makeWeeklySummary } from "@/lib/weekly-summary";
import { weeklyFileName } from "@/lib/weekly-summary-pdf";

// The VA's weekly summary PDF for the last 7 days (VFDA), the same one the
// Friday cron sends. Made now and stored; nothing is sent.
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: RouteContext<"/admin/vas/[id]/weekly-summary">) {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return new Response("Not allowed.", { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found.", { status: 404 });
  const made = await makeWeeklySummary(createAdminClient(), id);
  if (!made) return new Response("No quizzes in the last 7 days for this VA.", { status: 404 });
  return new Response(Buffer.from(made.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${weeklyFileName(made.summary).replace(/[^\w .()-]+/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

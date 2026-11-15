import { getCurrentUser } from "@/lib/auth";
import { guideFileName } from "@/lib/handoff-guide-pdf";
import { makeHandoffGuide } from "@/lib/handoff-guide";
import { createAdminClient } from "@/lib/supabase/server";

// The VA's handoff "show me" guide PDF (VFDA), made now from every quiz so
// far and stored, so the doctor's permanent link shows this copy too.
// Nothing is sent. Asks Claude for the prompts, so it can take a minute.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: RouteContext<"/admin/vas/[id]/handoff-guide">) {
  const user = await getCurrentUser();
  if (user?.role !== "vfda_admin") return new Response("Not allowed.", { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found.", { status: 404 });
  const made = await makeHandoffGuide(createAdminClient(), id);
  if (!made) return new Response("No finished quizzes yet for this VA.", { status: 404 });
  return new Response(Buffer.from(made.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${guideFileName(made.guide).replace(/[^\w .()-]+/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

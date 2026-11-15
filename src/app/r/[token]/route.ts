import { QUIZ_REPORT_BUCKET } from "@/lib/quiz-reports";
import { pathOfToken } from "@/lib/report-links";
import { createAdminClient } from "@/lib/supabase/server";

// A report PDF by its permanent link (src/lib/report-links.ts): no sign-in,
// no expiry. Doctors open it from the GHL email; it opens in the browser
// (or the phone's PDF viewer). Always the latest stored copy.
export const maxDuration = 30;

export async function GET(_request: Request, { params }: RouteContext<"/r/[token]">) {
  const path = pathOfToken((await params).token);
  if (!path) return new Response("This report link isn't valid. Please ask VFDA for a new one.", { status: 404 });
  const { data, error } = await createAdminClient().storage.from(QUIZ_REPORT_BUCKET).download(path);
  if (error || !data) return new Response("This report isn't available right now. Please ask VFDA for a new link.", { status: 404 });
  const name = path.split("/").pop()?.startsWith("handoff") ? "VFDA show-me guide.pdf" : path.includes("/weekly/") ? "VFDA weekly summary.pdf" : "VFDA quiz report.pdf";
  return new Response(Buffer.from(await data.arrayBuffer()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

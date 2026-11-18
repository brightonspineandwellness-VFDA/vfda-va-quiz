import "server-only";

// The training program's PDFs (the overview, one session's sheet): VFDA, or
// a doctor of the VA's office. Made from the stored sheet each time.

import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadProgram } from "@/lib/training-program";
import { overviewPdf, sessionPdf } from "@/lib/training-send";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function trainingPdfDownload(user: CurrentUser | null, vaId: string, session: number | null): Promise<Response> {
  if (user?.role !== "vfda_admin" && user?.role !== "doctor") return new Response("Not allowed.", { status: 403 });
  if (!UUID.test(vaId)) return new Response("Not found.", { status: 404 });
  const db = createAdminClient();
  const { data: va } = await db.from("profiles").select("office_id").eq("id", vaId).maybeSingle();
  if (!va?.office_id) return new Response("Not found.", { status: 404 });
  if (user.role === "doctor" && va.office_id !== user.officeId) return new Response("Not allowed.", { status: 403 });
  const { program, sessions } = await loadProgram(db, vaId, va.office_id);
  if (!program?.bank) return new Response("Not built yet.", { status: 404 });
  const s = session === null ? null : sessions.find((x) => x.number === session);
  if (session !== null && !s?.sheet) return new Response("Not found.", { status: 404 });
  const { filename, bytes } = s ? await sessionPdf(db, program, s) : await overviewPdf(db, program, sessions);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^\w .()-]+/g, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

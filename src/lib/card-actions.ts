"use server";

// Step 2: card PDFs. The doctor (or VFDA) uploads each PDF straight to the
// private office-documents bucket from the browser; these actions record it,
// remove one that hasn't been read yet, and "Done uploading", which starts
// rule extraction after the response is sent.

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { CARD_CHECKLIST } from "@/lib/doctor-flow";
import { DOCUMENT_BUCKET, runExtraction } from "@/lib/extraction";
import type { ActionResult } from "@/lib/interview-actions";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_NAMES: readonly string[] = CARD_CHECKLIST.map((c) => c.name);
const fail = (error: string) => ({ ok: false, error }) as const;

// VFDA for any office; a doctor for their own.
async function authorize(officeId: string) {
  if (!UUID.test(officeId)) return null;
  const user = await getCurrentUser();
  if (user?.role === "vfda_admin") return user;
  if (user?.role === "doctor" && user.officeId === officeId) return user;
  return null;
}

export async function addCardDocument(
  officeId: string,
  file: { path: string; name: string; cardName: string },
): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't upload cards for this office.");
  if (!file.path.startsWith(`${officeId}/cards/`) || file.path.includes("..")) return fail("Invalid file.");
  if (!/\.pdf$/i.test(file.name)) return fail("Upload the card as a PDF.");
  if (!CARD_NAMES.includes(file.cardName)) return fail("Unknown card.");
  const supabase = await createSessionClient();
  const { error } = await supabase.from("office_documents").insert({
    office_id: officeId,
    kind: "card",
    file_path: file.path,
    file_name: file.name.slice(0, 200),
    card_name: file.cardName,
    uploaded_by: user.id,
  });
  return error ? fail("Couldn't save the file. Try again.") : { ok: true, data: null };
}

export async function removeCardDocument(officeId: string, documentId: string): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't change this office's cards.");
  const supabase = await createSessionClient();
  const { data: doc } = await supabase
    .from("office_documents")
    .select("file_path, imported_at")
    .eq("id", documentId)
    .eq("office_id", officeId)
    .maybeSingle();
  if (!doc) return fail("That file is already gone.");
  if (doc.imported_at) return fail("This card has already been read. Ask VFDA to remove it.");
  const { error } = await supabase.from("office_documents").delete().eq("id", documentId);
  if (error) return fail("Couldn't remove the file. Try again.");
  await supabase.storage.from(DOCUMENT_BUCKET).remove([doc.file_path]);
  return { ok: true, data: null };
}

// "Done uploading": marks the upload step done and reads the new cards.
// VFDA's "Try again" after a failed read calls this too.
export async function finishUploading(officeId: string): Promise<ActionResult> {
  const user = await authorize(officeId);
  if (!user) return fail("You can't change this office's cards.");
  const supabase = await createSessionClient();
  const { count } = await supabase
    .from("office_documents")
    .select("id", { count: "exact", head: true })
    .eq("office_id", officeId)
    .eq("kind", "card");
  if (!count) return fail("Upload at least one card first.");

  // Doctors can't write offices; the checks above stand in for row-level security.
  const db = createAdminClient();
  const { error } = await db.from("offices").update({ cards_uploaded_at: new Date().toISOString() }).eq("id", officeId);
  if (error) return fail("Couldn't save. Try again.");
  await db.from("offices").update({ status: "rules_in_review" }).eq("id", officeId).eq("status", "setup");

  after(() => runExtraction(officeId));
  return { ok: true, data: null };
}

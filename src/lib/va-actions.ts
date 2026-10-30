"use server";

// The VA's actions: mark today's cards done, answer the item on screen, and
// add proof of work. Every unlock and grading rule is checked on the server
// (src/lib/va-training.ts); the browser only ever gets display fields.

import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/interview-actions";
import { createSessionClient } from "@/lib/supabase/server";
import { loadToday, markCardsDone, submitAnswer, type SubmitOutcome, type SubmittedAnswer } from "@/lib/va-training";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_CODE = /^W\dD\d$/;
const fail = (error: string) => ({ ok: false, error }) as const;

async function va() {
  const user = await getCurrentUser();
  return user?.role === "va" ? user : null;
}

export async function markTodaysCardsDone(): Promise<ActionResult> {
  const user = await va();
  if (!user) return fail("VAs only.");
  const error = await markCardsDone(user);
  return error ? fail(error) : { ok: true, data: null };
}

export async function answerItem(
  scenarioId: string,
  phase: "first" | "repeat",
  answer: SubmittedAnswer,
): Promise<ActionResult<SubmitOutcome>> {
  const user = await va();
  if (!user) return fail("VAs only.");
  if (!UUID.test(scenarioId) || (phase !== "first" && phase !== "repeat")) return fail("Invalid item.");
  return submitAnswer(user, scenarioId, phase, answer ?? {});
}

// Proof of work: a file already uploaded to the VA's own folder, or a link.
export async function addProof(
  day: string,
  proof: { path: string; name: string } | { link: string },
): Promise<ActionResult> {
  const user = await va();
  if (!user?.officeId) return fail("VAs only.");
  if (!DAY_CODE.test(day)) return fail("Unknown day.");

  // Only days on the VA's own path that have opened.
  const loaded = await loadToday(user);
  if (loaded.kind !== "ok" || !("days" in loaded.today)) return fail("Unknown day.");
  const view = loaded.today.days.find((d) => d.day.code === day);
  if (!view || view.status === "locked") return fail("This day hasn't opened yet.");
  if (view.day.proof_of_work.length === 0) return fail("This day has no proof of work.");

  let row: { file_path: string; file_name: string } | { link_url: string };
  if ("link" in proof) {
    let url: URL;
    try {
      url = new URL(proof.link.trim());
    } catch {
      return fail("Paste a full link, starting with https://");
    }
    if (url.protocol !== "https:") return fail("Paste a full link, starting with https://");
    row = { link_url: url.toString().slice(0, 2000) };
  } else {
    const folder = `${user.officeId}/${user.id}/${day}/`;
    if (!proof.path.startsWith(folder) || proof.path.includes("..")) return fail("Invalid file.");
    row = { file_path: proof.path, file_name: proof.name.slice(0, 200) };
  }

  // Written as the VA: row-level security checks it's their own, open day.
  const supabase = await createSessionClient();
  const { error } = await supabase.from("proof_uploads").insert({ va_id: user.id, schedule_day: day, ...row });
  return error ? fail("Couldn't save. Try again.") : { ok: true, data: null };
}

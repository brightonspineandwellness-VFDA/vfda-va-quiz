import "server-only";

// The handoff "show me" guide (src/lib/handoff-guide-pdf.ts): once a VA has
// finished every training day, a bank of check-in prompts for the doctor's
// twice-a-week meetings in the first month (8 meetings, 3-4 skills each).
// Built from everything the VA was quizzed on, as a mix: skills they did
// well, skills still building, and rules that came from a VFDA standard
// because the office's cards don't cover them. Claude writes the prompts
// (mock prompts with AI_MODE=mock, or when Claude's answer can't be used).
// Doctor only. Stored at quiz-reports/<office>/<va>/handoff-guide.pdf; sent
// once through Leads4Life (report_type "handoff_guide", permanent link) by
// the daily cron, and made again any time from VA progress (admin).

import { z } from "zod";
import { aiErrorMessage, aiMode, askStructured } from "@/lib/ai";
import { candidatesOf, interleave, MEETINGS, mockMeetings, PER_MEETING, whyTest, type Candidate, type Dated } from "@/lib/handoff-guide-core";
import { handoffGuidePdf, type GuideSkill, type HandoffGuide } from "@/lib/handoff-guide-pdf";
import { cardsTested as cardsOf, type DoneWellItem, type NeedsWorkItem } from "@/lib/quiz-report";
import { loadItems, QUIZ_REPORT_BUCKET } from "@/lib/quiz-reports";
import { slackEscape } from "@/lib/report";
import { permanentReportLink } from "@/lib/report-links";
import { loadReminderBoard } from "@/lib/reminders";
import { deliver, LEADS4LIFE, officeDoctors, postLeads4Life, postSlack, SLACK_RECIPIENT, type Target } from "@/lib/reports";
import { standardsUsed } from "@/lib/rule-source";
import { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient>;

const MAX_CANDIDATES = 60;
// The cron sends a guide only to VAs who finished within this many days
// (older finishers: make it from VA progress).
const RECENT_DAYS = 5;
// Guides made per cron run (each one asks Claude).
const PER_RUN = 1;
export const HANDOFF_EVENT = "handoff-guide";

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const GuideSchema = z.object({
  meetings: z.array(
    z.object({
      title: z.string().describe("2-5 words naming the meeting's theme, e.g. \"Phones and scheduling\""),
      skills: z.array(
        z.object({
          key: z.string().describe("The skill's key, exactly as given"),
          title: z.string().describe("The skill in 3-8 words"),
          showMe: z.string().describe('One "Show me how you..." request the VA can do on screen in a few minutes'),
          why: z.string().describe("One follow-up asking why they do it that way"),
          couldGoWrong: z.string().describe("One question about what could go wrong and how they'd handle it"),
          bestPractices: z.array(z.string()).describe("2-4 short things the doctor checks while watching, from the steps"),
        }),
      ),
    }),
  ),
});

const GUIDE_SYSTEM = `You write a check-in guide for a chiropractic doctor whose new virtual assistant (VA) just finished VFDA's training.
For the first month the doctor meets the VA twice a week (${MEETINGS} meetings) for 15-20 minutes. The doctor doesn't teach anything new:
they ask the VA to show them how they do things, so the doctor sees the training worked and the VA shows what they know.

Pick skills from <skills> (by key) and plan ${MEETINGS} meetings of 3-${PER_MEETING} skills each, grouped by theme.
- Mix every meeting: include skills marked mix="strength" (the VA does these well: let them show off), mix="building"
  (still building: <to_practice> says what to watch), and mix="not_on_cards" (graded on a VFDA standard because the office's cards
  don't cover it; the doctor should confirm it's how their office does it).
- Put safety skills (emergencies, red flags, patient identity, privacy) in the first meetings.
- The doctor is not a trained trainer. Make each prompt say exactly what to ask for and what a good answer shows.
- <history> says when the skill came up in training and whether the VA got it right. For a skill they had trouble with,
  aim showMe and couldGoWrong at the part in <to_practice>, so the doctor checks that exact piece is solid now.
- Each prompt is concrete for a chiropractic front desk and doable on screen. Use the steps given; never invent office policies.
- Tone: warm and practical, never shaming. Never use "wrong" or "failed".
- bestPractices: what good looks like, taken from the steps (and <to_practice> for building skills).`;

async function guideMeetings(candidates: Candidate[]): Promise<HandoffGuide["meetings"]> {
  if (aiMode() === "mock" || !candidates.length) return mockMeetings(candidates);
  const pool = interleave(candidates, MAX_CANDIDATES);
  const byKey = new Map(pool.map((c) => [c.key, c]));
  const text = `<skills>
${pool
  .map(
    (c) => `<skill key="${c.key}" mix="${c.mix}" workflow="${c.workflowName}" card="${c.card}">
<topic>${c.topic}</topic>
<steps>${c.steps.join("; ") || "(none listed)"}</steps>
${c.seen.length ? `<history>${c.seen.map((x) => `${x.day}: ${x.ok ? "got it right" : "needed help"}`).join("; ")}</history>` : ""}
${c.toPractice.length ? `<to_practice>${c.toPractice.join("; ")}</to_practice>` : ""}
</skill>`,
  )
  .join("\n")}
</skills>`;
  try {
    const raw = await askStructured(GuideSchema, { system: GUIDE_SYSTEM, content: [{ type: "text", text }], effort: "low", maxTokens: 16000 });
    const used = new Set<string>();
    const meetings = raw.meetings
      .map((m) => ({
        title: m.title.trim().slice(0, 60),
        skills: m.skills
          .filter((s) => byKey.has(s.key.trim()) && !used.has(s.key.trim()) && s.showMe.trim())
          .slice(0, PER_MEETING)
          .map((s): GuideSkill => {
            const c = byKey.get(s.key.trim())!;
            used.add(c.key);
            return {
              title: s.title.trim() || c.topic,
              card: c.card,
              mix: c.mix,
              whyTest: whyTest(c),
              showMe: s.showMe.trim(),
              why: s.why.trim(),
              couldGoWrong: s.couldGoWrong.trim(),
              bestPractices: s.bestPractices.map((b) => b.trim()).filter(Boolean).slice(0, 4),
            };
          }),
      }))
      .filter((m) => m.skills.length)
      .slice(0, MEETINGS);
    if (meetings.length >= Math.min(MEETINGS, Math.ceil(candidates.length / PER_MEETING))) return meetings;
    console.error("Handoff guide: Claude's plan was too short, using mock prompts");
  } catch (e) {
    console.error("Handoff guide prompts failed, using mock prompts:", aiErrorMessage(e));
  }
  return mockMeetings(candidates);
}

// The guide for one VA, from every day quiz and retake they took.
export async function buildHandoffGuide(db: Db, vaId: string): Promise<{ guide: HandoffGuide; officeId: string } | null> {
  const va = must(await db.from("profiles").select("full_name, email, office_id").eq("id", vaId).maybeSingle()) as {
    full_name: string | null;
    email: string | null;
    office_id: string | null;
  } | null;
  if (!va?.office_id) return null;
  const officeId = va.office_id;
  const [office, attempts, doctors] = await Promise.all([
    db.from("offices").select("name").eq("id", officeId).maybeSingle(),
    db
      .from("attempts")
      .select("id, kind, schedule_day")
      .eq("va_id", vaId)
      .eq("office_id", officeId)
      .in("kind", ["day", "retake"])
      .not("submitted_at", "is", null)
      .is("archived_at", null)
      .order("submitted_at"),
    officeDoctors(db, officeId),
  ]);
  const rows = (must(attempts) ?? []) as { id: string; kind: string; schedule_day: string }[];
  if (!rows.length) return null;
  const needsWork: NeedsWorkItem[] = [];
  const doneWell: DoneWellItem[] = [];
  // Oldest first, each item tagged with its day, for "why we're testing this".
  const dated: { item: Dated<NeedsWorkItem> | Dated<DoneWellItem>; building: boolean }[] = [];
  for (const a of rows) {
    const items = await loadItems(db, a.id);
    const day = a.kind === "retake" ? `${a.schedule_day} retake` : a.schedule_day;
    needsWork.push(...items.needsWork);
    doneWell.push(...items.doneWell);
    for (const i of items.doneWell) dated.push({ item: { ...i, day }, building: false });
    for (const i of items.needsWork) dated.push({ item: { ...i, day }, building: true });
  }
  const meetings = await guideMeetings(candidatesOf(dated));
  return {
    officeId,
    guide: {
      vaName: va.full_name?.trim() || va.email || "VA",
      officeName: ((must(office) as { name: string } | null)?.name ?? "Office") as string,
      doctors: doctors.primary ? [doctors.primary, ...doctors.list.map((d) => d.name).filter((n) => n !== doctors.primary)] : doctors.list.map((d) => d.name),
      date: new Date().toISOString(),
      daysDone: new Set(rows.filter((a) => a.kind === "day").map((a) => a.schedule_day)).size,
      meetings,
      cardsTested: cardsOf(needsWork, doneWell),
      standards: standardsUsed([...needsWork, ...doneWell].map((i) => i.ruleSource)),
    },
  };
}

// Made now and stored (replacing the old copy); its permanent link.
export async function makeHandoffGuide(db: Db, vaId: string) {
  const built = await buildHandoffGuide(db, vaId);
  if (!built) return null;
  const bytes = await handoffGuidePdf(built.guide);
  const path = `${built.officeId}/${vaId}/handoff-guide.pdf`;
  const { error } = await db.storage.from(QUIZ_REPORT_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`The handoff guide couldn't be stored: ${error.message}`);
  return { ...built, bytes, path, link: permanentReportLink(path) };
}

// The daily cron: a guide for every VA who just finished all their days and
// hasn't been sent one (a few per run).
export async function sendDueHandoffGuides(now = new Date()) {
  const db = createAdminClient();
  const board = await loadReminderBoard(db, now);
  const recent = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const due = board.filter(
    (v) =>
      v.finished &&
      v.lastSubmitted &&
      new Date(v.lastSubmitted).getTime() >= recent &&
      // Not sent yet, or something didn't go out (tried again while recent).
      (!v.rows.some((r) => r.event === HANDOFF_EVENT) || v.rows.some((r) => r.event === HANDOFF_EVENT && r.status !== "sent")),
  );
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const v of due.slice(0, PER_RUN)) {
    try {
      const r = await sendHandoffGuide(db, v.vaId);
      sent += r.sent;
      failed += r.failed;
    } catch (e) {
      failed++;
      errors.push(`${v.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { due: due.length, sent, failed, errors };
}

export async function sendHandoffGuide(db: Db, vaId: string) {
  const made = await makeHandoffGuide(db, vaId);
  if (!made) return { sent: 0, failed: 0 };
  const { guide: g, link } = made;
  const doctors = await officeDoctors(db, made.officeId);
  const subject = `${g.vaName} finished training: your show-me guide for month 1`;
  const leads4life = (d: { email: string; name: string }): Target => ({
    channel: LEADS4LIFE,
    recipient: d.email,
    send: () =>
      postLeads4Life(
        {
          doctor_email: d.email,
          doctor_name: d.name,
          office: g.officeName,
          va_name: g.vaName,
          day: "Handoff guide",
          topic: "Show-me training guide",
          result: "",
          first_try_score: "",
          raw_score: "",
          is_retake: "no",
          report_link: link,
          critical_errors: 0,
          flags: "none",
          email_subject: subject,
          report_type: "handoff_guide",
        },
        `handoff-${vaId}-${d.email}`,
      ),
  });
  return deliver(db, { va_id: vaId, event: HANDOFF_EVENT }, [
    {
      channel: "slack",
      recipient: SLACK_RECIPIENT,
      send: () =>
        postSlack({
          text: `*${slackEscape(subject)}* (${slackEscape(g.officeName)}): ${g.meetings.length} meetings.\n<${link}|Show-me guide PDF>`,
        }),
    },
    ...doctors.list.map(leads4life),
  ]);
}

import "server-only";

// Sending the 4-week training program, Sunday night (src/app/api/cron/weekly),
// starting the first Sunday after it was built, for 4 weeks in a row. VFDA is
// CC'd on everything.
// - Week 1, session 1: the FIRST email, "[VA]'s training plan for the next 4
//   weeks + Session 1: [focus]": what the VA knows, what to practice (Safety
//   first), the 4-week plan, this week's session; the overview PDF and the
//   Session 1 sheet attached.
// - Every other session: a short email, "Week n · Session n: [focus] –
//   30-minute training with [VA]", with its sheet attached (2 each Sunday).
// - The VA: one short Sunday email with that week's two topics and the cards
//   to review (no answers).
// Every send is a notifications row (va_id, event program:<id>:...), so a
// session is never sent twice. "Send this week now (test email)" sends the
// week due next to one address, marked [TEST] (logged as test:...).

import { escapeHtml } from "@/lib/report";
import { appUrl, deliver, officeDoctors, sendEmail, vfdaEmails, type Target } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/server";
import { firstNameOf, loadProgram, type ProgramRow, type SessionRow } from "@/lib/training-program";
import { overviewFileName, sheetFileName, trainingOverviewPdf, trainingSheetPdf } from "@/lib/training-pdf";
import type { Sheet } from "@/lib/training-plan";
import { sundayText } from "@/lib/week";

type Db = ReturnType<typeof createAdminClient>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const e = escapeHtml;
const wrap = (body: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${body}</div>`;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

type People = { vaName: string; vaEmail: string | null; officeName: string; doctor: string; doctorEmails: string[] };

async function people(db: Db, p: ProgramRow): Promise<People> {
  const [va, office, doctors] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", p.va_id).maybeSingle(),
    db.from("offices").select("name").eq("id", p.office_id).maybeSingle(),
    officeDoctors(db, p.office_id),
  ]);
  return {
    vaName: (must(va)?.full_name || must(va)?.email || "VA") as string,
    vaEmail: (must(va)?.email as string | null) ?? null,
    officeName: (must(office)?.name as string) ?? "Office",
    doctor: doctors.primary ?? doctors.list[0]?.name ?? "Doctor",
    doctorEmails: doctors.emails,
  };
}

const sheetOf = (s: SessionRow): Sheet => s.sheet!;
const shortTitle = (s: SessionRow) => sheetOf(s).title || s.focus.title;

export async function sessionPdf(db: Db, p: ProgramRow, s: SessionRow, who?: People) {
  const w = who ?? (await people(db, p));
  const ctx = { vaName: w.vaName, officeName: w.officeName, doctor: w.doctor, number: s.number, week: s.week, focus: s.focus, strength: s.strength, sheet: sheetOf(s) };
  return { filename: sheetFileName(ctx), bytes: await trainingSheetPdf(ctx) };
}

export async function overviewPdf(db: Db, p: ProgramRow, sessions: SessionRow[], who?: People) {
  const w = who ?? (await people(db, p));
  return {
    filename: overviewFileName(w.vaName),
    bytes: await trainingOverviewPdf({
      vaName: w.vaName,
      officeName: w.officeName,
      doctor: w.doctor,
      bank: p.bank!,
      sessions: sessions.map((s) => ({ number: s.number, week: s.week, sendOn: s.send_on, focus: shortTitle(s), safety: s.focus.safety, strength: s.strength.text })),
    }),
  };
}

// ---------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------

const greet = (doctor: string) => (/^dr\.?\s/i.test(doctor) ? doctor : `Dr. ${doctor.split(/\s+/).at(-1)}`);

// The FIRST email: the plan, and Session 1.
export function firstEmail(w: People, p: ProgramRow, sessions: SessionRow[], s1: SessionRow) {
  const va = firstNameOf(w.vaName);
  const bank = p.bank!;
  const link = `${appUrl()}/doctor/training/${p.va_id}`;
  const subject = `${va}'s training plan for the next 4 weeks + Session 1: ${shortTitle(s1)}`;
  const weeks = [1, 2, 3, 4].map((wk) => sessions.filter((s) => s.week === wk));
  const html = wrap(`<p>Hi ${e(greet(w.doctor))},</p>
<p>${e(va)} has finished all their quiz days. Great job getting ${e(va)} through training! Based on the results, here's what ${e(va)} already does well, what to practice, and your plan for the next 4 weeks.</p>
<h3 style="margin:18px 0 6px;font-size:15px;color:#15803d">What ${e(va)} knows</h3>
<ul>${bank.knows.map((k) => `<li>${e(k.text)}</li>`).join("")}</ul>
<h3 style="margin:18px 0 6px;font-size:15px">What ${e(va)} needs to practice</h3>
<ul>${bank.practice
    .map((f) => `<li>${e(f.title)}${f.safety ? ` <span style="background:#fdecec;color:#b91c1c;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:bold">Safety</span>` : ""}</li>`)
    .join("")}</ul>
<h3 style="margin:18px 0 6px;font-size:15px">Your 4-week plan (30 minutes, twice a week)</h3>
<table style="border-collapse:collapse;font-size:14px"><tr><th style="text-align:left;padding:6px 10px;background:#f3f5f8;border-bottom:1px solid #e2e6ec">Week</th><th style="text-align:left;padding:6px 10px;background:#f3f5f8;border-bottom:1px solid #e2e6ec">Session 1</th><th style="text-align:left;padding:6px 10px;background:#f3f5f8;border-bottom:1px solid #e2e6ec">Session 2</th></tr>
${weeks
  .map(
    (ss, n) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e6ec">${n + 1}</td>${ss.map((s) => `<td style="padding:6px 10px;border-bottom:1px solid #e2e6ec">${e(shortTitle(s))}</td>`).join("")}</tr>`,
  )
  .join("")}</table>
<p>Each session mixes what ${e(va)} finds harder with what ${e(va)} already knows, half and half, so ${e(va)} stays confident while learning. Every Sunday night you'll get that week's two training sheets.</p>
${bank.notCovered ? `<p style="color:#555">Not covered yet: ${e(bank.notCovered)}</p>` : ""}
<h3 style="margin:18px 0 6px;font-size:15px">This week: Session 1, ${e(shortTitle(s1))}</h3>
<p>${e(sheetOf(s1).emailLine)} The sheet has a 5-minute intro, 5 scenarios to ask ${e(va)} with what to listen for, and 2 wrap-up questions.</p>
<p>When you're done, click <b>Mark session done</b> in the app so VFDA can follow along: <a href="${e(link)}">${e(va)}'s training program</a>.</p>
<p>Attached: ${e(overviewFileName(w.vaName))} and the Session 1 sheet. Session 2 arrives in a second, shorter email tonight.</p>
<p>Thank you,<br>VFDA Team</p>`);
  const text = [
    `Hi ${greet(w.doctor)},`,
    `${va} has finished all their quiz days. Great job getting ${va} through training! Based on the results, here's what ${va} already does well, what to practice, and your plan for the next 4 weeks.`,
    `What ${va} knows:\n${bank.knows.map((k) => `- ${k.text}`).join("\n")}`,
    `What ${va} needs to practice:\n${bank.practice.map((f) => `- ${f.title}${f.safety ? " [Safety]" : ""}`).join("\n")}`,
    `Your 4-week plan (30 minutes, twice a week):\n${weeks.map((ss, n) => `Week ${n + 1}: ${ss.map(shortTitle).join(" | ")}`).join("\n")}`,
    `Each session mixes what ${va} finds harder with what ${va} already knows, half and half. Every Sunday night you'll get that week's two training sheets.`,
    bank.notCovered ? `Not covered yet: ${bank.notCovered}` : "",
    `This week: Session 1, ${shortTitle(s1)}\n${sheetOf(s1).emailLine}`,
    `When you're done, click Mark session done in the app so VFDA can follow along: ${link}`,
    "Thank you,\nVFDA Team",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}

export function sessionEmail(w: People, p: ProgramRow, s: SessionRow) {
  const va = firstNameOf(w.vaName);
  const link = `${appUrl()}/doctor/training/${p.va_id}`;
  const subject = `Week ${s.week} · Session ${s.number}: ${shortTitle(s)} – 30-minute training with ${va}`;
  const lines = [
    `Hi ${greet(w.doctor)},`,
    `Here's this week's Session ${s.number} of 8 with ${va}: ${shortTitle(s)}${s.focus.safety ? " (Safety)" : ""}, building on ${sheetOf(s).buildOn}.`,
    `${sheetOf(s).emailLine} The sheet (attached) has a 5-minute intro, 5 scenarios with what to listen for, and 2 wrap-up questions.`,
  ];
  const html = wrap(
    `${lines.map((l) => `<p>${e(l)}</p>`).join("")}<p>When you're done, click <b>Mark session done</b>: <a href="${e(link)}">${e(va)}'s training program</a>.</p><p>Thank you,<br>VFDA Team</p>`,
  );
  const text = `${lines.join("\n\n")}\n\nWhen you're done, click Mark session done: ${link}\n\nThank you,\nVFDA Team`;
  return { subject, html, text };
}

export function vaWeekEmail(w: People, week: number, ss: SessionRow[]) {
  const va = firstNameOf(w.vaName);
  const subject = `Your training this week (week ${week} of 4): ${ss.map(shortTitle).join(" and ")}`;
  const cards = [...new Set(ss.flatMap((s) => [...s.focus.cards, ...sheetOf(s).scenarios.map((x) => x.card)]).filter(Boolean))];
  const lines = [
    `Hi ${va},`,
    `This week you and ${greet(w.doctor)} have two short training sessions (30 minutes each):`,
  ];
  const html = wrap(
    `${lines.map((l) => `<p>${e(l)}</p>`).join("")}<ul>${ss.map((s) => `<li><b>${e(shortTitle(s))}</b>, building on ${e(sheetOf(s).buildOn)}</li>`).join("")}</ul><p><b>Cards to review before the sessions</b></p><ul>${cards.map((c) => `<li>${e(c)}</li>`).join("")}</ul><p>You're doing great. See you in training!</p>`,
  );
  const text = `${lines.join("\n\n")}\n${ss.map((s) => `- ${shortTitle(s)}, building on ${sheetOf(s).buildOn}`).join("\n")}\n\nCards to review before the sessions:\n${cards.map((c) => `- ${c}`).join("\n")}\n\nYou're doing great. See you in training!`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type Mail = { subject: string; html: string; text: string; attachments: { filename: string; content: string }[] };

// One week's emails: the doctor's (one per session; week 1 starts with the plan) and the VA's.
async function weekMails(db: Db, p: ProgramRow, sessions: SessionRow[], week: number, w: People) {
  const mine = sessions.filter((s) => s.week === week).sort((a, b) => a.number - b.number);
  const doctor: { session: SessionRow; mail: Mail }[] = [];
  for (const s of mine) {
    const sheet = await sessionPdf(db, p, s, w);
    if (s.number === 1) {
      const ov = await overviewPdf(db, p, sessions, w);
      doctor.push({
        session: s,
        mail: {
          ...firstEmail(w, p, sessions, s),
          attachments: [
            { filename: ov.filename, content: b64(ov.bytes) },
            { filename: sheet.filename, content: b64(sheet.bytes) },
          ],
        },
      });
    } else doctor.push({ session: s, mail: { ...sessionEmail(w, p, s), attachments: [{ filename: sheet.filename, content: b64(sheet.bytes) }] } });
  }
  return { doctor, va: mine.length ? { ...vaWeekEmail(w, week, mine), attachments: [] } : null, sessions: mine };
}

// The sessions due by this Sunday that haven't gone out, week by week.
export async function sendProgramWeek(db: Db, p: ProgramRow, sunday: string) {
  const { sessions } = await loadProgram(db, p.va_id, p.office_id);
  const due = sessions.filter((s) => s.send_on && s.send_on <= sunday && !s.sent_at && s.sheet);
  if (!due.length || !p.bank) return { sent: 0, failed: 0 };
  const w = await people(db, p);
  const vfda = [...new Set(vfdaEmails().map((x) => x.toLowerCase()))];
  const to = w.doctorEmails.length ? w.doctorEmails : vfda;
  const cc = w.doctorEmails.length ? vfda : [];
  let sent = 0;
  let failed = 0;
  for (const week of [...new Set(due.map((s) => s.week))].sort()) {
    const m = await weekMails(db, p, sessions, week, w);
    for (const d of m.doctor.filter((x) => due.some((s) => s.id === x.session.id))) {
      const target: Target = {
        channel: "email",
        recipient: to.join(", ").slice(0, 300),
        send: () => sendEmail(to, d.mail.subject, d.mail.html, d.mail.text, `program-${p.id}-s${d.session.number}`, d.mail.attachments, cc),
      };
      const r = await deliver(db, { va_id: p.va_id, event: `program:${p.id}:s${d.session.number}` }, [target]);
      sent += r.sent;
      failed += r.failed;
      // Sent now, or already sent by an earlier run.
      const { data: row } = await db
        .from("notifications")
        .select("sent_at")
        .match({ va_id: p.va_id, event: `program:${p.id}:s${d.session.number}`, channel: "email" })
        .not("sent_at", "is", null)
        .limit(1);
      if (row?.length) {
        await db.from("training_sessions").update({ sent_at: row[0].sent_at }).eq("id", d.session.id).is("sent_at", null);
        await db.from("training_sessions").update({ status: "sent" }).eq("id", d.session.id).eq("status", "scheduled");
      }
    }
    if (m.va && w.vaEmail) {
      const vaMail = m.va;
      const vaTo = w.vaEmail.toLowerCase();
      const r = await deliver(db, { va_id: p.va_id, event: `program:${p.id}:va-w${week}` }, [
        { channel: "email", recipient: vaTo, send: () => sendEmail(vaTo, vaMail.subject, vaMail.html, vaMail.text, `program-${p.id}-va-w${week}`, [], vfda) },
      ]);
      sent += r.sent;
      failed += r.failed;
    }
  }
  const after = (must(await db.from("training_sessions").select("sent_at").eq("program_id", p.id)) ?? []) as { sent_at: string | null }[];
  const status = after.length && after.every((s) => s.sent_at) ? "done" : after.some((s) => s.sent_at) ? "running" : p.status;
  if (status !== p.status) await db.from("training_programs").update({ status }).eq("id", p.id);
  return { sent, failed };
}

// Every ready or running program of the office, for this Sunday.
export async function sendOfficePrograms(db: Db, officeId: string, sunday: string) {
  const res = await db.from("training_programs").select("*").eq("office_id", officeId).in("status", ["ready", "running"]);
  if (res.error) return { programs: 0, sent: 0, failed: 0, skipped: res.error.message };
  let sent = 0;
  let failed = 0;
  for (const p of (res.data ?? []) as ProgramRow[]) {
    const r = await sendProgramWeek(db, p, sunday).catch((err: unknown) => {
      console.error("Training program not sent", p.id, err);
      return { sent: 0, failed: 1 };
    });
    sent += r.sent;
    failed += r.failed;
  }
  return { programs: (res.data ?? []).length, sent, failed };
}

// "Send this week now (test email)": the next week to go out (else week 1),
// every email of it (doctor's and VA's) to one address, marked [TEST]. No
// session is marked sent; each email is logged as test:<time>:...
export async function sendProgramTest(db: Db, vaId: string, officeId: string, to: string): Promise<{ error: string | null; week: number; subjects: string[] }> {
  const { program: p, sessions } = await loadProgram(db, vaId, officeId);
  if (!p || !p.bank || !sessions.length) return { error: "No training program yet: generate it first.", week: 0, subjects: [] };
  const week = sessions.find((s) => !s.sent_at)?.week ?? 1;
  const w = await people(db, p);
  const m = await weekMails(db, p, sessions, week, w);
  const stamp = new Date().toISOString();
  const subjects: string[] = [];
  const all: Mail[] = [...m.doctor.map((d) => d.mail), ...(m.va ? [m.va] : [])];
  for (const [n, mail] of all.entries()) {
    const subject = `[TEST] ${mail.subject}`;
    const target: Target = { channel: "email", recipient: to.toLowerCase(), send: () => sendEmail(to, subject, mail.html, mail.text, `test-program-${p.id}-${n}-${stamp}`, mail.attachments) };
    const r = await deliver(db, { va_id: vaId, event: `test:${stamp}:program:${p.id}:${n}` }, [target]);
    if (r.failed) {
      const { data } = await db.from("notifications").select("error").match({ va_id: vaId, event: `test:${stamp}:program:${p.id}:${n}` }).maybeSingle();
      return { error: data?.error ?? "not sent", week, subjects };
    }
    subjects.push(subject);
  }
  return { error: null, week, subjects };
}

// A session's first email, as text, for checking (F): subject and body.
export async function previewFirstEmail(db: Db, vaId: string, officeId: string) {
  const { program: p, sessions } = await loadProgram(db, vaId, officeId);
  if (!p?.bank || !sessions.length) return null;
  const w = await people(db, p);
  return { ...firstEmail(w, p, sessions, sessions[0]), sendOn: sessions[0].send_on ? sundayText(sessions[0].send_on) : null };
}

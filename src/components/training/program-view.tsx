import Link from "next/link";
import { MarkDoneForm } from "@/components/training/forms";
import { Badge, ButtonAnchor, Card, EmptyState, linkClass, Notice, StatTile, StatusBadge, Table, td, th } from "@/components/ui";
import type { loadProgramPage, SessionRow } from "@/lib/training-program";
import { sundayText } from "@/lib/week";

type PageData = Awaited<ReturnType<typeof loadProgramPage>>;

const STATUS: Record<SessionRow["status"], { label: string; tone: "neutral" | "info" | "success" }> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  done: { label: "Done ✓", tone: "success" },
};

// One VA's training program: the training bank (what they know, what to
// practice, not covered), then the 8 sessions with their status, sheet PDFs
// and "Mark session done". `base`: /admin/training/<va> or /doctor/training/<va>.
export function ProgramView({ data, vaName, base, admin }: { data: PageData; vaName: string; base: string; admin: boolean }) {
  const first = vaName.trim().split(/\s+/)[0] || "Your VA";
  const { program, sessions, readiness, missingTable } = data;
  if (missingTable) {
    return (
      <Notice tone="warning" title="Not set up yet">
        {admin ? "Run supabase/training-program.sql in the Supabase SQL Editor first." : "VFDA is setting this up."}
      </Notice>
    );
  }
  if (!program || program.status === "building" || program.status === "failed" || !program.bank) {
    return (
      <Card title="Training program">
        {program?.status === "building" ? (
          <p>Being built from {first}&apos;s quiz results. Refresh in a few minutes.</p>
        ) : (
          <EmptyState title={`Builds after all quiz days are done (${readiness.done} of ${readiness.total} finished)`}>
            Once {first} has submitted every scheduled quiz day{readiness.triggerDay ? ` (the last one is ${readiness.triggerDay})` : ""}, the training bank
            and a 4-week plan are built from the results. The sheets arrive by email on Sunday nights. Nothing is sent before then.
          </EmptyState>
        )}
        {admin && program?.status === "failed" && <p className="text-sm font-medium text-danger">The last build failed: {program.error}. It&apos;s tried again on Sunday night, or use Generate below.</p>}
      </Card>
    );
  }
  const bank = program.bank;
  const done = sessions.filter((s) => s.status === "done").length;
  return (
    <>
      {program.trigger === "test" && admin && (
        <Notice tone="info" title="Built for testing">
          Generated with the admin button
          {program.missing_days.length ? `, with ${program.missing_days.length} scheduled day(s) not submitted: ${program.missing_days.join(", ")}` : ""}. The
          doctor doesn&apos;t see it and it&apos;s never sent on Sunday; the real program replaces it once every scheduled day is submitted.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Quiz days" value={`${bank.daysDone} of ${bank.daysTotal}`} sub="completed" />
        <StatTile label="Overall" value={<StatusBadge label={bank.overall} size="lg" />} />
        <StatTile label="Strengths found" value={bank.knows.length} tone="success" />
        <StatTile label="Sessions done" value={`${done} of ${sessions.length}`} tone="accent" />
      </div>

      <Card title={`✓ What ${first} knows`} accent="success">
        <ul className="flex flex-col gap-2">
          {bank.knows.map((k) => (
            <li key={k.text} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span>{k.text}</span>
              <span className="text-sm text-muted">{[k.day, k.card].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`→ What ${first} needs to practice`} description="Ranked across all quiz days: safety first, then the workflows with the most to practice.">
        <ol className="flex flex-col gap-2">
          {bank.practice.map((p, n) => (
            <li key={p.title} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {n + 1}. {p.title}
                </span>
                {p.safety && <Badge tone="danger">Safety</Badge>}
                {p.standards.length > 0 && <Badge tone="info">VFDA standard</Badge>}
              </span>
              <span>{p.text}</span>
              <span className="text-sm text-muted">{[p.cards.join(", "), p.days.join(", ")].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
      </Card>

      {bank.notCovered && (
        <Notice tone="neutral" title="Not covered yet">
          {bank.notCovered}
        </Notice>
      )}

      <Card
        title="4-week training plan"
        description={`8 sessions of 30 minutes, 2 a week. Each pairs one thing to practice with one thing ${first} already does well, so it's 50/50. Sheets arrive by email every Sunday night.`}
        actions={
          <ButtonAnchor href={`${base}/overview-pdf`} size="sm">
            Overview PDF
          </ButtonAnchor>
        }
      >
        <Table>
          <thead>
            <tr>
              <th className={th}>Week</th>
              <th className={th}>Session</th>
              <th className={th}>Practice (focus)</th>
              <th className={th}>Build on (strength)</th>
              <th className={th}>Status</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className={`${td} whitespace-nowrap`}>
                  Week {s.week}
                  {s.number % 2 === 1 && s.send_on && <span className="block text-sm text-muted">{sundayText(s.send_on)}</span>}
                </td>
                <td className={td}>{s.number}</td>
                <td className={`${td} min-w-48`}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {s.sheet?.title ?? s.focus.title}
                    {s.focus.safety && <Badge tone="danger">Safety</Badge>}
                  </span>
                </td>
                <td className={`${td} min-w-40`}>{s.sheet?.buildOn ?? s.strength.text}</td>
                <td className={td}>
                  <span className="flex flex-col gap-1">
                    <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                    {s.done_note && <span className="text-sm text-muted">“{s.done_note}”</span>}
                    {admin && s.edited_at && <span className="text-xs text-muted">edited by VFDA</span>}
                  </span>
                </td>
                <td className={td}>
                  <span className="flex flex-wrap items-center gap-2">
                    <a href={`${base}/session/${s.number}/pdf`} className={linkClass}>
                      Sheet PDF
                    </a>
                    {admin && !s.sent_at && (
                      <Link href={`${base}/session/${s.number}`} className={linkClass}>
                        Edit before sending
                      </Link>
                    )}
                    {s.status !== "done" && <MarkDoneForm sessionId={s.id} />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

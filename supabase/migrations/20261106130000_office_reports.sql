-- Office SOP gap reports (VFDA only; doctors never see them).
--
-- Written after VFDA finishes reviewing an office's card rules ("Send to
-- doctor"), again after any re-import, and on demand: what the office's cards
-- miss against the VFDA standards and the 10 workflows, where they conflict,
-- what they only half cover, safety items first, and coaching points for VFDA
-- to discuss with the doctor. Emailed to VFDA_REPORT_EMAIL only and
-- summarized on Slack; each send's outcome is kept on the row.
--
-- Safe to run more than once.

create table if not exists public.office_reports (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references public.offices (id) on delete cascade,
  reason       text not null check (reason in ('review', 'reimport', 'manual')),
  content      jsonb not null,             -- {safety, missing, conflicts, partial, coaching} (src/lib/office-report.ts)
  counts       jsonb not null default '{}',
  created_by   uuid references public.profiles (id) on delete set null,
  emailed_at   timestamptz,
  email_error  text,
  slack_at     timestamptz,
  slack_error  text,
  created_at   timestamptz not null default now()
);
create index if not exists office_reports_office_created_idx on public.office_reports (office_id, created_at desc);

alter table public.office_reports enable row level security;
drop policy if exists "admin manages office reports" on public.office_reports;
create policy "admin manages office reports" on public.office_reports
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

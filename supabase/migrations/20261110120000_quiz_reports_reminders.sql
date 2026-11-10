-- Quiz report PDFs, Leads4Life delivery and reminders.
--
-- attempt_reports: each finished attempt's quiz report PDF, stored privately
-- in the quiz-reports bucket (<office>/<va>/<attempt>.pdf), and its signed
-- link (valid 30 days) as sent to Leads4Life. VFDA reads it; the office's
-- doctors read their own; VAs never (it holds the doctor's card tips).
--
-- notifications: a "leads4life" channel (one row per doctor and attempt),
-- and reminders to a VA (va_id, event behind:<episode> / overdue:<episode>).
--
-- Safe to run more than once.

create table if not exists public.attempt_reports (
  attempt_id      uuid primary key references public.attempts (id) on delete cascade,
  pdf_path        text not null,
  link            text not null,
  link_expires_at timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.attempt_reports;
create trigger set_updated_at before update on public.attempt_reports
  for each row execute function private.set_updated_at();

alter table public.attempt_reports enable row level security;
drop policy if exists "admin full access" on public.attempt_reports;
create policy "admin full access" on public.attempt_reports for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "doctor reads own office reports" on public.attempt_reports;
create policy "doctor reads own office reports" on public.attempt_reports for select to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and private.is_doctor_of_office(a.office_id)));

-- Reminders to a VA.
alter table public.notifications add column if not exists va_id uuid references public.profiles (id) on delete cascade;
create index if not exists notifications_va_id_idx on public.notifications (va_id);
create unique index if not exists notifications_va_event_recipient
  on public.notifications (va_id, event, channel, recipient);

alter table public.notifications drop constraint if exists notifications_check;
alter table public.notifications drop constraint if exists notifications_one_subject;
alter table public.notifications add constraint notifications_one_subject
  check (num_nonnulls(attempt_id, certification_id, va_id) = 1);

alter table public.notifications drop constraint if exists notifications_channel_check;
alter table public.notifications add constraint notifications_channel_check
  check (channel in ('email', 'slack', 'leads4life'));

-- Quiz report PDFs, private. The server reads and writes them with the
-- service role; VFDA admins may too.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-reports', 'quiz-reports', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "quiz reports: admin full access" on storage.objects;
create policy "quiz reports: admin full access" on storage.objects
  for all to authenticated
  using (bucket_id = 'quiz-reports' and (select private.is_admin()))
  with check (bucket_id = 'quiz-reports' and (select private.is_admin()));

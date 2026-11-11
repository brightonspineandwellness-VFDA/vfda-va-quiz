-- VA reports: the VA-safe version of each quiz report (My results -> My report).
--
-- One row per finished attempt, made when the attempt is graded (and by
-- "Backfill VA reports" for older attempts). It holds only what was written
-- for the VA: the critical errors in general terms, the coaching tips, and
-- what they did well. Never the scenarios, answers, answer keys, critical
-- fail text, VFDA notes or the doctor's Trello card tips. The header and the
-- trend are built on the server from the attempt each time.
--
-- Reports are available to the VA as soon as they are made (released_at);
-- VFDA can edit the text afterward (edited_at / edited_by).
-- emailed_at: the "results are ready" email to the VA went out.
--
-- Safe to run more than once.

create table if not exists public.va_reports (
  attempt_id  uuid primary key references public.attempts (id) on delete cascade,
  va_id       uuid not null references public.profiles (id) on delete cascade,
  office_id   uuid references public.offices (id) on delete cascade,
  alerts      jsonb not null default '[]'::jsonb, -- critical errors, general terms (strings)
  tips        jsonb not null default '[]'::jsonb, -- coaching tips, most important first (strings)
  strengths   jsonb not null default '[]'::jsonb, -- what they did well, 1-2 (strings)
  source      text not null default 'ai' check (source in ('ai', 'fallback')),
  released_at timestamptz not null default now(),
  emailed_at  timestamptz,
  edited_at   timestamptz,
  edited_by   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists va_reports_va_id_idx on public.va_reports (va_id);
create index if not exists va_reports_office_id_idx on public.va_reports (office_id);

drop trigger if exists set_updated_at on public.va_reports;
create trigger set_updated_at before update on public.va_reports
  for each row execute function private.set_updated_at();

alter table public.va_reports enable row level security;
drop policy if exists "admin full access" on public.va_reports;
create policy "admin full access" on public.va_reports for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "doctor reads own office va reports" on public.va_reports;
create policy "doctor reads own office va reports" on public.va_reports for select to authenticated
  using (private.is_doctor_of_office(office_id));
-- A VA reads only their own reports, once released. No writes.
drop policy if exists "va reads own released reports" on public.va_reports;
create policy "va reads own released reports" on public.va_reports for select to authenticated
  using (va_id = (select auth.uid()) and released_at <= now());

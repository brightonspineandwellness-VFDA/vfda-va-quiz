-- Phase 4: build each office's scenarios and let VFDA approve them per day.
--
-- The app fills every {PLACEHOLDER} with the office's accepted rules; Claude
-- writes what can't be filled mechanically (multiple choice options built from
-- a rule, repeat variants, version B, gray card items, a skipped day's phone
-- drills). VFDA reviews each day beside the master, edits, and approves it;
-- approving sets the day's scenarios live, which opens it to VAs.
--
-- Safe to run more than once.

-- One training day for one office: build status and VFDA approval.
create table if not exists public.office_days (
  office_id     uuid not null references public.offices (id) on delete cascade,
  schedule_day  text not null references public.schedule_days (code) on update cascade,
  kind          text not null default 'standard' check (kind in ('standard', 'gray', 'skipped')),
  build_status  text not null default 'none' check (build_status in ('none', 'running', 'done', 'failed')),
  build_started_at timestamptz,
  built_at      timestamptz,
  build_error   text,
  approved_at   timestamptz,
  approved_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (office_id, schedule_day)
);

drop trigger if exists set_updated_at on public.office_days;
create trigger set_updated_at before update on public.office_days
  for each row execute function private.set_updated_at();

alter table public.office_days enable row level security;
revoke all on public.office_days from anon;
drop policy if exists "admin full access" on public.office_days;
create policy "admin full access" on public.office_days for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "doctor reads own office days" on public.office_days;
create policy "doctor reads own office days" on public.office_days for select to authenticated
  using (private.is_doctor_of_office(office_id));

-- Rule keys a scenario still needs (no accepted rule yet). A day can't be
-- approved while any of its scenarios is missing one.
alter table public.office_scenarios add column if not exists missing_keys text[] not null default '{}';
-- Which gray card formula an item came from (W2D5), e.g. 'S-1'.
alter table public.office_scenarios add column if not exists formula text;

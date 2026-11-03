-- Forgiving, per-item scenario checks.
--
-- A card-first item that still fails its checks after two rewrites is saved
-- with test_status 'needs_review' and the error, and the rest of the day is
-- built. VFDA edits, regenerates or removes it; a day can't be approved while
-- any item needs review. Every failed check is written to the System log.
--
-- Safe to run more than once.

alter table public.office_scenarios add column if not exists review_error text;
alter table public.office_scenarios drop constraint if exists office_scenarios_test_status_check;
alter table public.office_scenarios add constraint office_scenarios_test_status_check
  check (test_status in ('draft', 'vfda_reviewed', 'live', 'needs_review'));

-- The System log (/admin/logs). Written by the server (service role) only;
-- VFDA admins read it.
create table if not exists public.system_logs (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  kind         text not null,                -- 'scenario_check'
  office_id    uuid references public.offices (id) on delete cascade,
  schedule_day text,
  item         text,
  field        text,
  value        text,
  reason       text not null
);
create index if not exists system_logs_created_at_idx on public.system_logs (created_at desc);
create index if not exists system_logs_office_id_idx on public.system_logs (office_id);

alter table public.system_logs enable row level security;
drop policy if exists "admin reads system log" on public.system_logs;
create policy "admin reads system log" on public.system_logs
  for select to authenticated
  using ((select private.is_admin()));

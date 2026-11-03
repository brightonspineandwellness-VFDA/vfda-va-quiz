-- Build versions: a day can be rebuilt even after a VA has started it.
--
-- Every Rebuild writes a new build_version (1, 2, 3...) of the day's
-- office_scenarios as drafts; older versions are never edited or deleted.
-- office_days.build_version is the latest version built (what VFDA reviews),
-- office_days.live_version the one VFDA approved (what new attempts get).
-- Each day attempt keeps the build_version it started on, for its reports and
-- review.
--
-- "Reset day (test)": VFDA archives one VA's attempt at a day (kept, marked
-- archived, with who and when) so the VA can take the day again on the live
-- version. Archived attempts don't count in scores or reports.
--
-- Existing builds become version 1; a day VAs could already take (approved, or
-- every item live) has version 1 live. Safe to run more than once.

alter table public.office_scenarios add column if not exists build_version integer not null default 1;
alter table public.office_scenarios drop constraint if exists office_scenarios_build_version_check;
alter table public.office_scenarios add constraint office_scenarios_build_version_check check (build_version >= 1);
drop index if exists public.office_scenarios_one_per_code;
create unique index office_scenarios_one_per_code
  on public.office_scenarios (office_id, schedule_day, build_version, version, code) where not is_repeat_variant;
create index if not exists office_scenarios_day_version_idx
  on public.office_scenarios (office_id, schedule_day, build_version);

alter table public.office_days add column if not exists build_version integer;
alter table public.office_days add column if not exists live_version integer;

update public.office_days d
  set build_version = coalesce(
    (select max(s.build_version) from public.office_scenarios s
      where s.office_id = d.office_id and s.schedule_day = d.schedule_day),
    case when d.build_status = 'done' then 1 end)
  where d.build_version is null;

update public.office_days d
  set live_version = d.build_version
  where d.live_version is null
    and d.build_version is not null
    and (d.approved_at is not null
      or (exists (select 1 from public.office_scenarios s
                   where s.office_id = d.office_id and s.schedule_day = d.schedule_day
                     and s.version = 'A' and not s.is_repeat_variant)
          and not exists (select 1 from public.office_scenarios s
                   where s.office_id = d.office_id and s.schedule_day = d.schedule_day
                     and s.version = 'A' and not s.is_repeat_variant and s.test_status <> 'live')));
update public.office_days set approved_at = coalesce(approved_at, now()) where live_version is not null;

alter table public.attempts add column if not exists build_version integer;
alter table public.attempts add column if not exists archived_at timestamptz;
alter table public.attempts add column if not exists archived_by uuid references public.profiles (id) on delete set null;
update public.attempts set build_version = 1 where kind = 'day' and build_version is null;

-- One live attempt per day; archived ones don't count.
drop index if exists public.attempts_one_per_day;
create unique index attempts_one_per_day
  on public.attempts (va_id, office_id, schedule_day, version) where kind = 'day' and archived_at is null;
create index if not exists attempts_office_day_version_idx
  on public.attempts (office_id, schedule_day, build_version);

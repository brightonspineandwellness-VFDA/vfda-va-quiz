-- One optional retake of a whole day.
--
-- A day labeled Needs coaching or At risk can be retaken once. It never
-- blocks the next day. The retake is its own attempt (kind 'retake',
-- is_retake, parent_attempt_id: the day's first attempt) with every question
-- of the day as a new version: same correct answer, new details, written like
-- the repeat variants (office_scenarios rows marked recheck, i.e. drill
-- variants, never served as a day's repeat). The immediate repeat still runs
-- during the retake. The first try stays the official score; certification
-- uses first-try scores only.
--
-- Safe to run more than once.

alter table public.attempts add column if not exists is_retake boolean not null default false;
alter table public.attempts add column if not exists parent_attempt_id uuid references public.attempts (id) on delete cascade;
create index if not exists attempts_parent_attempt_id_idx on public.attempts (parent_attempt_id);

alter table public.attempts drop constraint if exists attempts_kind_check;
alter table public.attempts add constraint attempts_kind_check check (kind in ('day', 'retrain', 'recheck', 'retake'));
-- Retrains and rechecks belong to a certification; days and retakes don't.
alter table public.attempts drop constraint if exists attempts_drill_has_certification;
alter table public.attempts add constraint attempts_drill_has_certification
  check ((kind in ('retrain', 'recheck')) = (certification_id is not null));
alter table public.attempts drop constraint if exists attempts_retake_has_parent;
alter table public.attempts add constraint attempts_retake_has_parent
  check ((kind = 'retake') = is_retake and (kind = 'retake') = (parent_attempt_id is not null));
-- Once per day attempt (an archived one, reset by VFDA for testing, doesn't count).
create unique index if not exists attempts_one_retake
  on public.attempts (parent_attempt_id) where kind = 'retake' and archived_at is null;

-- A scenario has one repeat variant; drill variants (rechecks, retakes) of
-- the same scenario are extra rows and may be many.
drop index if exists public.office_scenarios_one_repeat;
create unique index office_scenarios_one_repeat
  on public.office_scenarios (parent_scenario_id) where is_repeat_variant and not recheck;

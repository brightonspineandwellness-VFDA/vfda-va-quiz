-- DEMO ONLY: gives the demo office live scenarios for W1D1 and W1D2 (versions
-- A and B, with a repeat variant for every situational item), so the demo VA
-- can try the Today page and the scenario screen before the scenario builder
-- (Phase 4) exists. {PLACEHOLDERS} are left as they are; repeat variants are
-- the master scenario with "(Repeat)" in front.
--
-- Run after phase4.sql (which comes after phase5.sql), `npm run import:bank` and
-- supabase/seed.sql. To build real scenarios instead, use Offices -> Scenarios.
-- Running it again resets the demo VA's training (unlocks, attempts, proof)
-- and sets their start date to today.
-- Fake data only: no real patients, logins or card numbers.
--
-- Then, as the demo VA: Today → "Mark today's cards done" → Go to today's
-- scenarios. Grading situational answers needs ANTHROPIC_API_KEY (and credit);
-- without it, those items are saved as ungraded and the day goes to VFDA review.
-- As VFDA: Admin → VA training to accept proof of work and decide reviews.

do $$
declare
  office uuid := '00000000-0000-4000-8000-000000000001';  -- Demo Spine & Wellness (FAKE)
begin
  if not exists (select 1 from public.offices where id = office) then
    raise exception 'The demo office is missing. Run supabase/seed.sql first.';
  end if;
  if not exists (select 1 from public.scenarios where schedule_day = 'W1D1') then
    raise exception 'No master scenarios. Run npm run import:bank first.';
  end if;

  -- Start over: the demo VA's progress, then the demo scenarios.
  delete from public.attempts a using public.profiles p
    where a.va_id = p.id and p.office_id = office and p.role = 'va';
  delete from public.day_unlocks u using public.profiles p
    where u.va_id = p.id and p.office_id = office and p.role = 'va';
  delete from public.proof_uploads x using public.profiles p
    where x.va_id = p.id and p.office_id = office and p.role = 'va';
  delete from public.office_scenarios where office_id = office and schedule_day in ('W1D1', 'W1D2');

  -- Multiple choice items whose options are built per office (options_rule)
  -- are left out: there's nothing to show until Phase 4 builds them.
  insert into public.office_scenarios (office_id, scenario_id, schedule_day, version, workflow, part, part_title,
    code, type, points, answer_format, stem, options, answer, correct_response, critical_fail, escalation_level,
    test_status, position)
  select office, s.id, s.schedule_day, s.version, s.workflow, s.part, s.part_title, s.code, s.type, s.points,
         s.answer_format, s.stem, s.options, s.answer, s.correct_response, s.critical_fail, s.escalation_level,
         'live', s.position
  from public.scenarios s
  where s.schedule_day in ('W1D1', 'W1D2')
    and s.condition = 'always'
    and (s.type = 'situational' or s.options is not null);

  -- Version B for any day the bank has no version B for: a copy of version A.
  insert into public.office_scenarios (office_id, scenario_id, schedule_day, version, workflow, part, part_title,
    code, type, points, answer_format, stem, options, answer, correct_response, critical_fail, escalation_level,
    test_status, position)
  select office_id, scenario_id, schedule_day, 'B', workflow, part, part_title, code, type, points, answer_format,
         stem, options, answer, correct_response, critical_fail, escalation_level, test_status, position
  from public.office_scenarios a
  where a.office_id = office and a.version = 'A' and a.schedule_day in ('W1D1', 'W1D2')
    and not exists (select 1 from public.office_scenarios b
                    where b.office_id = office and b.schedule_day = a.schedule_day and b.version = 'B');

  insert into public.office_scenarios (office_id, scenario_id, schedule_day, version, workflow, part, part_title,
    code, type, points, answer_format, stem, correct_response, critical_fail, escalation_level,
    is_repeat_variant, parent_scenario_id, test_status, position)
  select office_id, scenario_id, schedule_day, version, workflow, part, part_title, code, type, points,
         answer_format, '(Repeat) ' || stem, correct_response, critical_fail, escalation_level,
         true, id, 'live', position
  from public.office_scenarios
  where office_id = office and type = 'situational' and not is_repeat_variant
    and schedule_day in ('W1D1', 'W1D2');

  -- Shown as built and approved on VFDA's Scenarios page.
  insert into public.office_days (office_id, schedule_day, kind, build_status, built_at, approved_at)
  values (office, 'W1D1', 'standard', 'done', now(), now()), (office, 'W1D2', 'standard', 'done', now(), now())
  on conflict (office_id, schedule_day) do update
    set build_status = 'done', built_at = now(), approved_at = now(), build_error = null;

  update public.profiles set va_start_date = current_date where office_id = office and role = 'va';
end $$;

select schedule_day, version, count(*) filter (where not is_repeat_variant) as scenarios,
       count(*) filter (where is_repeat_variant) as repeat_variants
from public.office_scenarios
where office_id = '00000000-0000-4000-8000-000000000001'
group by 1, 2 order by 1, 2;

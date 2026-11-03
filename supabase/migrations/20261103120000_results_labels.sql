-- Quizzes measure understanding; they never block.
--
-- A day opens once the day before it was submitted (any score), the VA marked
-- its cards done and VFDA approved its scenarios for the office. Each day has
-- exactly one attempt: no retakes, no version B. The day gets a label instead
-- of pass / review / retake:
--   Strong          first try >= 80% and no critical error
--   Needs coaching  first try 60-79%, or a repeat still below 2/2
--   At risk         first try below 60%, or any critical error
-- Workflows are Certified, Coaching needed (VFDA decides the follow-up;
-- nothing is assigned automatically) or Pending. The VA sees their score and
-- feedback as soon as they submit.
--
-- Safe to run more than once.

-- Day status: locked, open, or done (its one attempt submitted).
alter table public.day_unlocks drop constraint if exists day_unlocks_status_check;
update public.day_unlocks u
   set status = 'done'
 where u.status in ('submitted', 'passed', 'in_review', 'retake')
    or (u.status = 'open' and exists (
          select 1 from public.attempts a
           where a.va_id = u.va_id and a.office_id = u.office_id and a.schedule_day = u.schedule_day
             and a.kind = 'day' and a.submitted_at is not null));
update public.day_unlocks set version = 'A' where version <> 'A';
alter table public.day_unlocks add constraint day_unlocks_status_check check (status in ('locked', 'open', 'done'));
alter table public.day_unlocks drop column if exists opens_on;

-- "Your quiz is being prepared, VFDA has been notified": VFDA is told once.
alter table public.day_unlocks add column if not exists prep_notified_at timestamptz;

-- Retakes and retrains not started yet are gone.
delete from public.attempts where kind = 'day' and version = 'B' and submitted_at is null;
delete from public.attempts where kind = 'retrain' and submitted_at is null;

-- Labels. Answers the grader couldn't score count toward neither points nor
-- max (first_try_points / max_points already leave them out of points).
alter table public.attempts drop constraint if exists attempts_result_check;
update public.attempts a
   set result = case
         when a.critical_errors > 0
           or coalesce(a.max_points, 0) = 0
           or a.first_try_points * 100 < 60 * a.max_points then 'at_risk'
         when a.first_try_points * 100 < 80 * a.max_points
           or exists (
                select 1 from public.attempt_items i
                 where i.attempt_id = a.id
                   and i.repeat_scenario_id is not null
                   and coalesce((i.vfda_override ->> 'repeat_score')::int, i.repeat_score) < 2) then 'needs_coaching'
         else 'strong'
       end
 where a.submitted_at is not null
   and (a.result is null or a.result not in ('strong', 'needs_coaching', 'at_risk'));
alter table public.attempts add constraint attempts_result_check
  check (result in ('strong', 'needs_coaching', 'at_risk'));

-- Score and feedback are the VA's as soon as they submit.
update public.attempts set feedback_released_at = submitted_at
 where submitted_at is not null and feedback_released_at is null;

-- Workflow status: Retrain becomes Coaching needed.
alter table public.certifications drop constraint if exists certifications_status_check;
update public.certifications set status = 'coaching' where status = 'retrain';
alter table public.certifications add constraint certifications_status_check
  check (status in ('pending', 'coaching', 'certified'));

-- One attempt can now have more than one notice per recipient: its report
-- (event '') and an immediate alert for each critical error.
drop index if exists public.notifications_attempt_recipient;
create unique index if not exists notifications_attempt_event_recipient
  on public.notifications (attempt_id, event, channel, recipient);

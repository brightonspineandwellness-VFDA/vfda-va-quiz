-- Daily release schedule: one quiz released each weekday at 8 am office time
-- (offices.time_zone), starting on the VA's start date. The releases are
-- worked out from the start date (src/lib/release-schedule.ts); this column
-- keeps only VFDA's changes to a VA's schedule:
--   {"pauses": [{"paused_at": "...", "resumed_at": "..." | null}],
--    "early":  {"W1D3": "<released at>"}}   ("Release next day now")
-- Morning emails are notifications rows (va_id, event release:<day> /
-- late-va:<date> / late:<date> / behind:<date>), so none is sent twice.
--
-- Safe to run more than once.

alter table public.profiles add column if not exists release_schedule jsonb not null default '{}'::jsonb;

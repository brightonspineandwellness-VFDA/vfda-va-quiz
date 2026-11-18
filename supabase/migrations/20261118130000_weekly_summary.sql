-- Weekly summary (Sunday night): each office's time zone decides when its
-- Sunday is (default US Eastern). Every summary sent is a notifications row
-- (va_id, event weekly:<Sunday date>), so a VA's week is never sent twice.
--
-- Safe to run more than once.

alter table public.offices add column if not exists time_zone text not null default 'America/New_York';

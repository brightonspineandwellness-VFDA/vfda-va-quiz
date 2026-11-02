-- Phase 6b: grading and reports.
--
-- notifications.status: 'pending' while a report is being sent, 'sent' or
-- 'failed' after (each send is tried twice before it counts as failed).
-- attempt_items.vfda_override (already there) holds a VFDA score override:
-- {first_score, repeat_score, critical_error, note, by, at}.
--
-- Safe to run more than once.

alter table public.notifications add column if not exists status text not null default 'pending';

alter table public.notifications drop constraint if exists notifications_status_check;
alter table public.notifications add constraint notifications_status_check
  check (status in ('pending', 'sent', 'failed'));

update public.notifications set status = 'sent' where sent_at is not null and status <> 'sent';
update public.notifications set status = 'failed' where sent_at is null and error is not null and status = 'pending';

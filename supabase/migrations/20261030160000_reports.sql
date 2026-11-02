-- Phase 6: results reports by email (Resend) and Slack.
--
-- One notifications row per report and recipient, written by the server
-- before sending, so a retry never sends the same report twice; sent_at is
-- set once it went out, error when it didn't.
--
-- Safe to run more than once.

create unique index if not exists notifications_one_per_attempt_recipient
  on public.notifications (attempt_id, channel, recipient) where attempt_id is not null;
create unique index if not exists notifications_one_per_certification_recipient
  on public.notifications (certification_id, channel, recipient) where certification_id is not null;

alter table public.notifications add column if not exists attempts integer not null default 0;

-- Skills reports: VAs and doctors see no scores. Each VA report keeps the
-- short names of the skills the VA showed ("Verifying callers"), shown as a
-- checkmark list by workflow on My report, the doctor's PDF and the weekly
-- summary. Lines are "[Workflow name] Skill".
--
-- Safe to run more than once.

alter table public.va_reports add column if not exists skills jsonb not null default '[]'::jsonb;

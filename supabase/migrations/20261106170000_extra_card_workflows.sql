-- Extra (gray) cards as workflows.
--
-- A card that covers no standard topic is an extra card. Each one gets a
-- mini workflow in office_workflows (WF-G1, WF-G2...), read from the card:
-- name, trigger, steps, definition of done, what the VA decides, what needs
-- approval or immediate escalation, and the card's own words. "process" when
-- it has steps, "info" (info only) when it has none. A phone-call process is
-- built into W2D1 (routine) or W2D2 instead of W2D5. VFDA edits and approves
-- each one before scenarios are built from it.
--
-- W2D5 keeps its item count; extra cards that don't fit are listed on the
-- day's review page (office_days.left_out). W2D5 now allows situational items.
--
-- Safe to run more than once.

alter table public.office_workflows add column if not exists source_document_id uuid
  references public.office_documents (id) on delete cascade;
alter table public.office_workflows add column if not exists kind text not null default 'process';
alter table public.office_workflows drop constraint if exists office_workflows_kind_check;
alter table public.office_workflows add constraint office_workflows_kind_check check (kind in ('process', 'info'));
alter table public.office_workflows add column if not exists phone text not null default 'none';
alter table public.office_workflows drop constraint if exists office_workflows_phone_check;
alter table public.office_workflows add constraint office_workflows_phone_check check (phone in ('none', 'routine', 'advanced'));
alter table public.office_workflows add column if not exists source_quotes jsonb not null default '[]';  -- [{field, quote}]
alter table public.office_workflows add column if not exists patient_facing boolean not null default false;
alter table public.office_workflows add column if not exists risky boolean not null default false;
alter table public.office_workflows add column if not exists approved_at timestamptz;
alter table public.office_workflows add column if not exists approved_by uuid references public.profiles (id) on delete set null;
create unique index if not exists office_workflows_one_per_card
  on public.office_workflows (source_document_id) where source_document_id is not null;

-- Extra cards left out of W2D5 (more process cards than its item count).
alter table public.office_days add column if not exists left_out jsonb not null default '[]';  -- [{code, name, reason}]

-- W2D5 allows situational items (task scenarios from process cards); calls
-- still only on W2D1 and W2D2. Added only where VFDA hasn't set a W2D5 rule.
update public.settings
   set value = jsonb_set(
         value,
         '{days,W2D5}',
         '{"focus": "The office''s own extra cards: task scenarios from their processes, questions about their information.", "types": ["mc", "situational", "describe"], "banned": ["phone calls", "emergencies", "911", "red flags", "care plans", "report of findings"]}'::jsonb,
         true)
 where key = 'day_rules'
   and value ? 'days'
   and not (value -> 'days' ? 'W2D5');

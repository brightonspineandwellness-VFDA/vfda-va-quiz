-- Call practice reports: one report for every 10 finished practice calls of
-- a VA (calls 1-10, 11-20, ...), in the quiz report's format: what went well,
-- skills to practice, important to review, flags, and coaching ideas for the
-- doctor. Built on the server (src/lib/call-practice/report.ts).
--
-- Only a NEW table. Nothing the quizzes use is altered.
-- Safe to run more than once.

create table if not exists public.call_reports (
  id         uuid primary key default gen_random_uuid(),
  va_id      uuid not null references public.profiles (id) on delete cascade,
  office_id  uuid not null references public.offices (id) on delete cascade,
  sequence   integer not null check (sequence >= 1),   -- 1 = calls 1-10, 2 = calls 11-20, ...
  call_ids   uuid[] not null,
  first_call_at timestamptz not null,
  last_call_at  timestamptz not null,
  content    jsonb not null,                            -- the report (see report.ts)
  created_at timestamptz not null default now(),
  unique (va_id, office_id, sequence)
);

create index if not exists call_reports_va on public.call_reports (va_id, created_at desc);
create index if not exists call_reports_office on public.call_reports (office_id, created_at desc);

alter table public.call_reports enable row level security;

-- Same pattern as practice_calls: VFDA everything, doctor their office, VA their own.
-- Only the server writes reports.
drop policy if exists "admin full access" on public.call_reports;
create policy "admin full access" on public.call_reports
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "doctor reads own office call reports" on public.call_reports;
create policy "doctor reads own office call reports" on public.call_reports
  for select to authenticated
  using (private.is_doctor_of_office(office_id));

drop policy if exists "va reads own call reports" on public.call_reports;
create policy "va reads own call reports" on public.call_reports
  for select to authenticated
  using (va_id = (select auth.uid()) and (select private.my_role()) = 'va');

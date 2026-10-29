-- Row-level security on every table.
--   vfda_admin: everything.
--   doctor:     only their own clinic's rows (and their VAs' results).
--   va:         only their own unlocks, released attempts and proof uploads;
--               quiz items only through get_open_quiz_items(), never answer keys.
--   no role:    nothing but their own profile.
-- The service-role key (server only) bypasses all of this for grading and reports.

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies can look up the caller's profile
-- without recursing into profiles' own policies. Not exposed by the API.
-- ---------------------------------------------------------------------------

create or replace function private.my_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function private.my_clinic_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select clinic_id from public.profiles where id = (select auth.uid());
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.my_role() = 'vfda_admin', false);
$$;

-- True when the caller is the doctor of this clinic.
create or replace function private.is_doctor_of_clinic(p_clinic_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.my_role() = 'doctor' and private.my_clinic_id() = p_clinic_id, false);
$$;

-- True when the caller is the doctor of the clinic this quiz was built for.
create or replace function private.is_doctor_of_clinic_quiz(p_clinic_quiz_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_quizzes q
    where q.id = p_clinic_quiz_id
      and private.is_doctor_of_clinic(q.clinic_id)
  );
$$;

-- True when the caller is a VA with an unlock row for this quiz (any status).
create or replace function private.va_has_unlock(p_clinic_quiz_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.my_role() = 'va' and exists (
    select 1 from public.unlocks u
    where u.clinic_quiz_id = p_clinic_quiz_id
      and u.va_id = (select auth.uid())
  );
$$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Turn RLS on everywhere. Logged-out visitors (anon) get no table access at all.
-- ---------------------------------------------------------------------------

alter table public.interview_questions enable row level security;
alter table public.quiz_templates      enable row level security;
alter table public.question_templates  enable row level security;
alter table public.settings            enable row level security;
alter table public.clinics             enable row level security;
alter table public.profiles            enable row level security;
alter table public.interview_answers   enable row level security;
alter table public.gray_cards          enable row level security;
alter table public.clinic_quizzes      enable row level security;
alter table public.clinic_questions    enable row level security;
alter table public.unlocks             enable row level security;
alter table public.attempts            enable row level security;
alter table public.proof_uploads       enable row level security;
alter table public.notifications       enable row level security;

revoke all on
  public.interview_questions, public.quiz_templates, public.question_templates,
  public.settings, public.clinics, public.profiles, public.interview_answers,
  public.gray_cards, public.clinic_quizzes, public.clinic_questions,
  public.unlocks, public.attempts, public.proof_uploads, public.notifications
from anon;

-- ---------------------------------------------------------------------------
-- vfda_admin: full access to every table.
-- ---------------------------------------------------------------------------

create policy "admin full access" on public.interview_questions for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.quiz_templates for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.question_templates for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.settings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.clinics for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.profiles for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.interview_answers for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.gray_cards for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.clinic_quizzes for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.clinic_questions for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.unlocks for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.attempts for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.proof_uploads for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin full access" on public.notifications for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Everyone signed in: their own profile (read only; only VFDA changes roles).
-- ---------------------------------------------------------------------------

create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Master content. question_templates and settings stay admin-only.
-- ---------------------------------------------------------------------------

create policy "doctor reads interview questions" on public.interview_questions
  for select to authenticated
  using ((select private.my_role()) = 'doctor');

-- Quiz titles, cards and points; no answer keys live in this table.
create policy "doctor and va read quiz templates" on public.quiz_templates
  for select to authenticated
  using ((select private.my_role()) in ('doctor', 'va'));

-- ---------------------------------------------------------------------------
-- Doctor: own clinic only.
-- ---------------------------------------------------------------------------

create policy "doctor and va read own clinic" on public.clinics
  for select to authenticated
  using (id = (select private.my_clinic_id()) and (select private.my_role()) in ('doctor', 'va'));

create policy "doctor reads own clinic profiles" on public.profiles
  for select to authenticated
  using (private.is_doctor_of_clinic(clinic_id));

create policy "doctor reads own interview" on public.interview_answers
  for select to authenticated
  using (private.is_doctor_of_clinic(clinic_id));
create policy "doctor adds own interview answers" on public.interview_answers
  for insert to authenticated
  with check (private.is_doctor_of_clinic(clinic_id) and answered_by = (select auth.uid()));
create policy "doctor edits own interview answers" on public.interview_answers
  for update to authenticated
  using (private.is_doctor_of_clinic(clinic_id))
  with check (private.is_doctor_of_clinic(clinic_id) and answered_by = (select auth.uid()));
create policy "doctor deletes own interview answers" on public.interview_answers
  for delete to authenticated
  using (private.is_doctor_of_clinic(clinic_id));

create policy "doctor manages own gray cards" on public.gray_cards
  for all to authenticated
  using (private.is_doctor_of_clinic(clinic_id))
  with check (private.is_doctor_of_clinic(clinic_id));

create policy "doctor reads own clinic quizzes" on public.clinic_quizzes
  for select to authenticated
  using (private.is_doctor_of_clinic(clinic_id));

create policy "doctor reads own clinic questions" on public.clinic_questions
  for select to authenticated
  using (private.is_doctor_of_clinic_quiz(clinic_quiz_id));

create policy "doctor reads own VAs' unlocks" on public.unlocks
  for select to authenticated
  using (private.is_doctor_of_clinic_quiz(clinic_quiz_id));

create policy "doctor reads own VAs' attempts" on public.attempts
  for select to authenticated
  using (private.is_doctor_of_clinic_quiz(clinic_quiz_id));

create policy "doctor reads own VAs' proof uploads" on public.proof_uploads
  for select to authenticated
  using (private.is_doctor_of_clinic_quiz(clinic_quiz_id));

create policy "doctor reads own clinic reports" on public.notifications
  for select to authenticated
  using (exists (
    select 1 from public.attempts a
    where a.id = attempt_id and private.is_doctor_of_clinic_quiz(a.clinic_quiz_id)
  ));

-- ---------------------------------------------------------------------------
-- VA: own rows only. No direct access to clinic_questions or question_templates.
-- Unlocks and attempts are written by the server (service role), never the VA.
-- ---------------------------------------------------------------------------

create policy "va reads own unlocks" on public.unlocks
  for select to authenticated
  using (va_id = (select auth.uid()) and (select private.my_role()) = 'va');

-- The quiz shells (title, version, status) a VA has been assigned.
create policy "va reads assigned clinic quizzes" on public.clinic_quizzes
  for select to authenticated
  using (private.va_has_unlock(id));

-- Scores and AI feedback stay hidden until VFDA releases them.
create policy "va reads own released attempts" on public.attempts
  for select to authenticated
  using (
    va_id = (select auth.uid())
    and (select private.my_role()) = 'va'
    and feedback_released_at is not null
  );

create policy "va reads own proof uploads" on public.proof_uploads
  for select to authenticated
  using (va_id = (select auth.uid()) and (select private.my_role()) = 'va');

create policy "va adds own proof uploads" on public.proof_uploads
  for insert to authenticated
  with check (
    va_id = (select auth.uid())
    and (select private.my_role()) = 'va'
    and status = 'pending'
    and review_note is null
    and exists (
      select 1 from public.unlocks u
      where u.va_id = (select auth.uid())
        and u.clinic_quiz_id = proof_uploads.clinic_quiz_id
        and u.status <> 'locked'
    )
  );

-- ---------------------------------------------------------------------------
-- The only way a VA can read quiz items. Returns display columns only
-- (never answer, look_for or critical_fail), and only for a quiz that is
-- approved by VFDA and open for this VA right now.
-- ---------------------------------------------------------------------------

create or replace function public.get_open_quiz_items(p_clinic_quiz_id uuid)
returns table (
  id            uuid,
  "position"    integer,
  part          text,
  part_title    text,
  code          text,
  type          text,
  points        smallint,
  answer_format text,
  stem          text,
  options       jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.unlocks u
    join public.clinic_quizzes q on q.id = u.clinic_quiz_id
    where u.clinic_quiz_id = p_clinic_quiz_id
      and u.va_id = (select auth.uid())
      and u.status = 'open'
      and q.status = 'approved'
      and private.my_role() = 'va'
  ) then
    raise exception 'This quiz is not open for you.' using errcode = '42501';
  end if;

  return query
    select c.id, c.position, c.part, c.part_title, c.code, c.type,
           c.points, c.answer_format, c.stem, c.options
    from public.clinic_questions c
    where c.clinic_quiz_id = p_clinic_quiz_id
    order by c.position, c.code;
end;
$$;

revoke all on function public.get_open_quiz_items(uuid) from public, anon;
grant execute on function public.get_open_quiz_items(uuid) to authenticated;

-- Office data (per clinic, from the interview) and people (logins).

-- One office. Profile answers are copied here from the interview because they
-- decide which quizzes and parts the office gets.
create table public.clinics (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  status             text not null default 'interview' check (status in
                       ('interview', 'quizzes_in_review', 'va_training', 'done')),
  bills_insurance    boolean,
  billing_type       text check (billing_type in ('insurance', 'cash', 'both', 'none')),
  has_reexam_card    boolean,
  has_gray_cards     boolean,
  remote_access_tool text,                      -- null = not answered, 'none' = no remote access
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One login. Created automatically when someone first signs in, with no role:
-- they see nothing until VFDA (or supabase/seed.sql) gives them one.
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text not null,
  full_name           text not null default '',
  role                text check (role in ('vfda_admin', 'doctor', 'va')),
  clinic_id           uuid references public.clinics (id) on delete set null,
  training_start_date date,                     -- VAs only: day 1 of their training
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- doctors and VAs always belong to a clinic
  check (role is null or role = 'vfda_admin' or clinic_id is not null)
);
create index on public.profiles (clinic_id);
create index on public.profiles (lower(email));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- One interview answer for one office.
create table public.interview_answers (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  question_key text not null references public.interview_questions (key) on update cascade,
  value        jsonb,
  attachments  jsonb not null default '[]',     -- storage paths or Loom links
  answered_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (clinic_id, question_key)
);

-- One extra office-specific task (gray card).
create table public.gray_cards (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  answers    jsonb not null default '{}',       -- CARD_NAME, CARD_TRIGGER, ... from settings.gray_card_questions
  risk_tag   text check (risk_tag in ('high_risk', 'frequent', 'occasional')),
  frequency  text,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.gray_cards (clinic_id);

-- One quiz built for one office. Version A and version B are separate rows.
create table public.clinic_quizzes (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics (id) on delete cascade,
  quiz_template_id uuid not null references public.quiz_templates (id) on delete restrict,
  version          text not null default 'A' check (version in ('A', 'B')),
  status           text not null default 'draft' check (status in ('draft', 'in_review', 'approved')),
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, quiz_template_id, version)
);
create index on public.clinic_quizzes (quiz_template_id);

-- One filled-in item. Holds answer keys: never readable by VAs (see get_open_quiz_items).
-- Display fields are copied in so gray-card items, which have no master item, work the same way.
create table public.clinic_questions (
  id                   uuid primary key default gen_random_uuid(),
  clinic_quiz_id       uuid not null references public.clinic_quizzes (id) on delete cascade,
  question_template_id uuid references public.question_templates (id) on delete set null,
  gray_card_id         uuid references public.gray_cards (id) on delete set null,
  position             integer not null default 0,
  part                 text not null,
  part_title           text not null default '',
  code                 text not null,
  type                 text not null check (type in ('mc', 'situational')),
  points               smallint not null check (points in (1, 2)),
  answer_format        text check (answer_format in ('steps_say_doc', 'say_do_book')),
  stem                 text not null,
  options              jsonb,
  answer               text,
  look_for             jsonb,
  critical_fail        text,
  edited_by_vfda       boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (clinic_quiz_id, code)
);

create trigger set_updated_at before update on public.clinics
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.interview_answers
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.gray_cards
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.clinic_quizzes
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.clinic_questions
  for each row execute function private.set_updated_at();

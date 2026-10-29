-- Master content: the same for every office, loaded from seed/quiz-bank.json.

-- Helpers live in a schema the Supabase API does not expose.
create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One interview question, e.g. EHR_PATH_SEARCH.
create table public.interview_questions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  quiz        text not null,                    -- 'PROFILE' or a quiz code like 'W1D1'
  question    text not null,
  answer_type text not null check (answer_type in
                ('text', 'list', 'yesno', 'upload', 'matrix', 'click_path', 'choice')),
  condition   text not null default 'always',   -- a key of settings.conditions
  source      text not null default '',
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One of the 10 quizzes (W1D1 ... W2D5).
create table public.quiz_templates (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  week              smallint not null check (week between 1 and 2),
  day               smallint not null check (day between 1 and 5),
  title             text not null,
  cards             text[] not null default '{}',
  condition         text not null default 'always',
  max_points        integer not null check (max_points > 0),
  pass_points       integer not null,
  review_min_points integer not null,
  answer_format     text not null check (answer_format in ('steps_say_doc', 'say_do_book')),
  proof_of_work     text[] not null default '{}',
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (week, day),
  check (review_min_points <= pass_points and pass_points <= max_points)
);

-- One quiz item, version A or B. Holds answer keys: never readable by VAs.
create table public.question_templates (
  id               uuid primary key default gen_random_uuid(),
  quiz_template_id uuid not null references public.quiz_templates (id) on delete cascade,
  part             text not null,                -- 'A', 'B', 'B-alt', ...
  part_title       text not null default '',
  condition        text not null default 'always',
  code             text not null,                -- 'A1', 'B3', ...
  version          text not null default 'A' check (version in ('A', 'B')),
  type             text not null check (type in ('mc', 'situational')),
  stem             text not null,
  options          jsonb,                        -- fixed options for mc items
  options_rule     text,                         -- or a rule for building them per office
  answer           text,                         -- mc answer
  look_for         jsonb,                        -- situational grading points
  critical_fail    text,
  bank_ref         text not null default '',
  points           smallint not null check (points in (1, 2)),
  answer_format    text check (answer_format in ('steps_say_doc', 'say_do_book')),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (quiz_template_id, code, version)
);
create index on public.question_templates (quiz_template_id);

-- JSON settings from the Quiz Bank: conditions, grading, sequence, gray_* ...
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.interview_questions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.quiz_templates
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.question_templates
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.settings
  for each row execute function private.set_updated_at();

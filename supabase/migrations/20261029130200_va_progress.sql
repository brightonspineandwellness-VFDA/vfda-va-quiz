-- VA progress: unlocks, attempts, proof of work, and sent reports.

-- One VA's status on one quiz (one version of it).
create table public.unlocks (
  id             uuid primary key default gen_random_uuid(),
  va_id          uuid not null references public.profiles (id) on delete cascade,
  clinic_quiz_id uuid not null references public.clinic_quizzes (id) on delete cascade,
  status         text not null default 'locked' check (status in
                   ('locked', 'open', 'submitted', 'passed', 'in_review', 'retake')),
  cards_done_at  timestamptz,
  unlocked_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (va_id, clinic_quiz_id)
);
create index on public.unlocks (clinic_quiz_id);

-- One quiz attempt. The unique key enforces one attempt per version.
create table public.attempts (
  id                   uuid primary key default gen_random_uuid(),
  va_id                uuid not null references public.profiles (id) on delete cascade,
  clinic_quiz_id       uuid not null references public.clinic_quizzes (id) on delete cascade,
  version              text not null check (version in ('A', 'B')),
  started_at           timestamptz not null default now(),
  submitted_at         timestamptz,
  answers              jsonb not null default '{}',   -- keyed by clinic_questions.id
  item_times           jsonb not null default '{}',   -- seconds spent per item
  paste_log            jsonb not null default '[]',   -- logged, never blocked
  score                numeric(6, 2),
  result               text check (result in ('pass', 'review', 'retake')),
  critical_errors      jsonb not null default '[]',
  ai_evaluation        jsonb,
  vfda_override        jsonb,                          -- {score, note, by, at}
  feedback_released_at timestamptz,                    -- VA sees the attempt only after this is set
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (va_id, clinic_quiz_id)
);
create index on public.attempts (clinic_quiz_id);

-- One proof-of-work file or Loom link.
create table public.proof_uploads (
  id             uuid primary key default gen_random_uuid(),
  va_id          uuid not null references public.profiles (id) on delete cascade,
  clinic_quiz_id uuid not null references public.clinic_quizzes (id) on delete cascade,
  file_path      text,                                 -- path in Supabase Storage
  link_url       text,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'redo')),
  review_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (file_path is not null or link_url is not null)
);
create index on public.proof_uploads (va_id);
create index on public.proof_uploads (clinic_quiz_id);

-- One report sent about an attempt.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  channel    text not null check (channel in ('email', 'slack')),
  recipient  text not null,
  sent_at    timestamptz,
  error      text,
  created_at timestamptz not null default now()
);
create index on public.notifications (attempt_id);

create trigger set_updated_at before update on public.unlocks
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.attempts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.proof_uploads
  for each row execute function private.set_updated_at();

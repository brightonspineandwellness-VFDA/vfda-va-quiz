-- Phase 3: doctor interview, gray cards and interview uploads.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Clinics: add-ons from the PROFILE question ADDONS (each becomes a gray card).
-- ---------------------------------------------------------------------------
alter table public.clinics add column if not exists addons text[] not null default '{}';

-- Keep answers to a sane size (a long script pasted as text is fine).
alter table public.interview_answers drop constraint if exists interview_answers_size;
alter table public.interview_answers add constraint interview_answers_size
  check (octet_length(coalesce(value::text, '')) + octet_length(attachments::text) <= 200000);

-- Doctors need the condition rules and gray card questions to fill in the
-- interview. Only those two settings; grading and the rest stay admin-only.
drop policy if exists "doctor reads interview settings" on public.settings;
create policy "doctor reads interview settings" on public.settings
  for select to authenticated
  using ((select private.my_role()) = 'doctor' and key in ('conditions', 'gray_card_questions'));

-- ---------------------------------------------------------------------------
-- Profile answers are copied onto the clinic automatically, whoever saves them.
-- Doctors can't update clinics directly; this trigger does it for them.
-- Values: yes/no questions store "yes" or "no"; REMOTE_ACCESS_TOOL stores the
-- tool name, and "none"/"no"/"n/a" mean no remote access.
-- ---------------------------------------------------------------------------
create or replace function private.sync_profile_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   public.interview_answers;
  v   jsonb;
  txt text;
begin
  if tg_op = 'DELETE' then
    r := old;
    v := null;
  else
    r := new;
    v := new.value;
  end if;
  txt := case when jsonb_typeof(v) = 'string' then nullif(btrim(v #>> '{}'), '') end;

  case r.question_key
    when 'BILLS_INSURANCE' then
      update public.clinics set bills_insurance =
        case lower(txt) when 'yes' then true when 'no' then false end
      where id = r.clinic_id;
    when 'HAS_REEXAM_CARD' then
      update public.clinics set has_reexam_card =
        case lower(txt) when 'yes' then true when 'no' then false end
      where id = r.clinic_id;
    when 'HAS_GRAY_CARDS' then
      update public.clinics set has_gray_cards =
        case lower(txt) when 'yes' then true when 'no' then false end
      where id = r.clinic_id;
    when 'BILLING_TYPE' then
      update public.clinics set billing_type =
        case when lower(txt) in ('insurance', 'cash', 'both', 'none') then lower(txt) end
      where id = r.clinic_id;
    when 'REMOTE_ACCESS_TOOL' then
      update public.clinics set remote_access_tool =
        case
          when txt is null then null
          when lower(txt) in ('none', 'no', 'n/a', 'na', 'nothing', '-') then 'none'
          else txt
        end
      where id = r.clinic_id;
    when 'ADDONS' then
      update public.clinics set addons = coalesce((
        select array_agg(btrim(e))
        from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) e
        where btrim(e) <> ''
      ), '{}')
      where id = r.clinic_id;
    else
      null;
  end case;
  return null;
end;
$$;

drop trigger if exists sync_profile_answer on public.interview_answers;
create trigger sync_profile_answer
  after insert or update of value or delete on public.interview_answers
  for each row execute function private.sync_profile_answer();

-- ---------------------------------------------------------------------------
-- Gray cards: only VFDA sets the risk tag; frequency mirrors CARD_FREQUENCY.
-- ---------------------------------------------------------------------------
create or replace function private.guard_gray_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- auth.uid() is null for the service role and the SQL Editor: trusted.
  if (select auth.uid()) is not null and not private.is_admin() then
    if tg_op = 'INSERT' then
      new.risk_tag := null;
    else
      new.risk_tag := old.risk_tag;
    end if;
  end if;
  new.frequency := nullif(btrim(coalesce(new.answers ->> 'CARD_FREQUENCY', '')), '');
  return new;
end;
$$;

drop trigger if exists guard_gray_card on public.gray_cards;
create trigger guard_gray_card
  before insert or update on public.gray_cards
  for each row execute function private.guard_gray_card();

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for interview uploads (scripts, screenshots).
-- Files live at <clinic id>/<question key or gray-cards/...>/<file>.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interview-uploads', 'interview-uploads', false, 52428800,
  array[
    'image/*', 'application/pdf', 'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "interview uploads: admin full access" on storage.objects;
create policy "interview uploads: admin full access" on storage.objects
  for all to authenticated
  using (bucket_id = 'interview-uploads' and (select private.is_admin()))
  with check (bucket_id = 'interview-uploads' and (select private.is_admin()));

drop policy if exists "interview uploads: doctor reads own clinic" on storage.objects;
create policy "interview uploads: doctor reads own clinic" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'interview-uploads'
    and (select private.my_role()) = 'doctor'
    and (storage.foldername(name))[1] = (select private.my_clinic_id())::text
  );

drop policy if exists "interview uploads: doctor adds to own clinic" on storage.objects;
create policy "interview uploads: doctor adds to own clinic" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'interview-uploads'
    and (select private.my_role()) = 'doctor'
    and (storage.foldername(name))[1] = (select private.my_clinic_id())::text
  );

drop policy if exists "interview uploads: doctor deletes own clinic" on storage.objects;
create policy "interview uploads: doctor deletes own clinic" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'interview-uploads'
    and (select private.my_role()) = 'doctor'
    and (storage.foldername(name))[1] = (select private.my_clinic_id())::text
  );

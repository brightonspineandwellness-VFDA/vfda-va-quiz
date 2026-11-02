-- DEMO ONLY: pretend the demo office uploaded two Trello card PDFs, they were
-- read (text, color, suggested day mapping), and VFDA reviewed most of the
-- rules found on them. Lets you test card mapping, the doctor's steps and
-- card-first scenario building without real PDFs (use AI_MODE=mock to build
-- without the Claude API).
--
-- Run after card-first.sql, `npm run import:bank` and supabase/seed.sql.
-- Running it again resets the demo cards and their rules (it never un-sends:
-- if VFDA already sent the questions to the doctor, that stays).
-- Fake data only: no real patients, logins or card numbers.
--
-- Then, as VFDA (Offices → the demo office → Cards):
--   Card mapping        both cards suggested for W1D1; change or keep
--   Rules on the cards  one still to review (no-show rule, partial); accept or
--                       reject it, then "Send to doctor"
--   Scenarios           Build W1D1: written from the two cards
-- As the demo doctor, after "Send to doctor":
--   Questions for you   only must-ask rules the cards didn't cover (escalation
--                       contact: the two cards disagree), with VFDA suggestions
--   VFDA standards      one checkbox

do $$
declare
  office uuid := '00000000-0000-4000-8000-000000000001';  -- Demo Spine & Wellness (FAKE)
  doc1   uuid := '00000000-0000-4000-8000-0000000000d1';
  doc2   uuid := '00000000-0000-4000-8000-0000000000d2';
  text1  text := array_to_string(array[
    'VA Onboarding (FAKE)',
    'Answer: "Thank you for calling Demo Spine & Wellness, this is ___, how can I help?"',
    'We offer adjustments, decompression, massage and rehab.',
    'We do NOT do acupuncture or in-office X-rays.',
    'Our mission: help every family live pain-free without drugs or surgery.',
    'Never tell a caller what is wrong with them. The doctor decides at the first visit.',
    'New patient calls: get name, phone, reason for visit, and how they heard about us. Offer the first open new patient slot.',
    'If stuck, text Dr. Demo.'
  ], E'\n');
  text2  text := array_to_string(array[
    'Open & Close Daily List (FAKE)',
    'Hours: M/W/F 8-12 & 2-6, Tue 2-6, Thu closed',
    'Open: voicemail + texts, confirm today, print day sheet.',
    'Call everyone back within the hour.',
    'No-shows: call them same day.',
    'Close: check tomorrow''s schedule for gaps, send the EOD report in Slack.',
    'Questions go to Pat, office manager, in Slack.'
  ], E'\n');
begin
  if not exists (select 1 from public.offices where id = office) then
    raise exception 'The demo office is missing. Run supabase/seed.sql first.';
  end if;

  insert into public.office_documents
    (id, office_id, kind, file_path, file_name, card_name, imported_at, created_at,
     card_title, card_color, extracted_text, schedule_days, workflow, skip, tags, mapped_by, mapped_at)
  values
    (doc1, office, 'card', office || '/demo/onboarding-cards.pdf', 'VA Onboarding cards (FAKE).pdf', 'VA Onboarding',
     now(), now() - interval '1 minute',
     'VA Onboarding', 'green', text1, '{W1D1}', 'WF04', false, '{patient_facing}', null, null),
    (doc2, office, 'card', office || '/demo/daily-list-cards.pdf', 'Daily List cards (FAKE).pdf', 'Open & Close',
     now(), now() - interval '1 minute',
     'Open & Close Daily List', 'green', text2, '{W1D1}', 'WF10', false, '{}', null, null)
  on conflict (id) do update
    set card_name = excluded.card_name,
        card_title = excluded.card_title,
        card_color = excluded.card_color,
        extracted_text = excluded.extracted_text,
        schedule_days = excluded.schedule_days,
        workflow = excluded.workflow,
        skip = false,
        tags = excluded.tags,
        mapped_by = null,
        mapped_at = null;

  -- Uploaded and read; VFDA's review comes next.
  update public.offices
  set cards_uploaded_at = coalesce(cards_uploaded_at, now()),
      extraction_status = 'done',
      extracted_at = now(),
      extraction_error = null
  where id = office;

  -- Cards are no longer read for every rule slot, only VFDA standards and the
  -- must-ask rules; clear any older demo rows for other slots.
  delete from public.office_rules
  where office_id = office and source_document_id in (doc1, doc2)
    and rule_slot_key in ('SERVICES', 'NOT_OFFERED', 'OFFICE_MISSION', 'GREETING', 'OPENING_TASKS');

  insert into public.office_rules
    (office_id, rule_slot_key, rule, source, source_document_id, source_quote, status, vfda_reviewed_at)
  values
    (office, 'ESCALATION_CONTACT', '"Dr. Demo by text"',
     'card_import', doc1, 'If stuck, text Dr. Demo.', 'accepted', now()),
    (office, 'ESCALATION_CONTACT', '"Office manager (Pat) on Slack"',
     'card_import', doc2, 'Questions go to Pat, office manager, in Slack.', 'accepted', now()),
    (office, 'OFFICE_HOURS', '"Mon, Wed, Fri 8-12 and 2-6; Tue 2-6; Thu closed."',
     'card_import', doc2, 'Hours: M/W/F 8-12 & 2-6, Tue 2-6, Thu closed', 'accepted', now()),
    (office, 'CALLBACK_TIME', '"Within 1 hour during office hours."',
     'card_import', doc2, 'Call everyone back within the hour.', 'accepted', now()),
    -- Waiting for VFDA: only part of the rule is on the card.
    (office, 'NO_SHOW_RULE', '"Call no-shows the same day."',
     'card_import', doc2, 'No-shows: call them same day.', 'proposed', null)
  on conflict (office_id, rule_slot_key, source_document_id) do update
    set rule = excluded.rule,
        source = 'card_import',
        source_quote = excluded.source_quote,
        status = excluded.status,
        vfda_reviewed_at = excluded.vfda_reviewed_at,
        doctor_approved_by = null,
        doctor_approved_at = null;

  update public.office_rules set partial = (rule_slot_key = 'NO_SHOW_RULE')
  where office_id = office and source_document_id in (doc1, doc2);

  raise notice 'Demo cards ready: check the mapping and review them as VFDA, then send to the doctor.';
end $$;

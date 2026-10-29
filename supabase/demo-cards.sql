-- DEMO ONLY: pretend VFDA uploaded two Trello card PDFs for the demo office
-- and reviewed the rules extracted from them. Lets you test the doctor's
-- "Your cards" and "VFDA standards" steps before PDF import exists.
--
-- Run after phase2c.sql, `npm run import:bank` and supabase/seed.sql.
-- Running it again resets the demo card rules to "waiting for the doctor".
-- Fake data only: no real patients, logins or card numbers.
--
-- What you'll see as the demo doctor:
--   VA Onboarding & Basics   services, not offered, mission, greeting found;
--                            escalation contact conflicts between the two PDFs;
--                            USP and core values not found (short questions)
--   Open & Close Daily List  office hours + opening tasks found; closing tasks a question
--   other groups             not found yet (short questions)
--   VFDA standards           callback time: your card says something different

do $$
declare
  office uuid := '00000000-0000-4000-8000-000000000001';  -- Demo Spine & Wellness (FAKE)
  doc1   uuid := '00000000-0000-4000-8000-0000000000d1';
  doc2   uuid := '00000000-0000-4000-8000-0000000000d2';
begin
  if not exists (select 1 from public.offices where id = office) then
    raise exception 'The demo office is missing. Run supabase/seed.sql first.';
  end if;

  insert into public.office_documents (id, office_id, kind, file_path, file_name, imported_at)
  values
    (doc1, office, 'card', office || '/demo/onboarding-cards.pdf', 'VA Onboarding cards (FAKE).pdf', now()),
    (doc2, office, 'card', office || '/demo/daily-list-cards.pdf', 'Daily List cards (FAKE).pdf', now())
  on conflict (id) do nothing;

  insert into public.office_rules
    (office_id, rule_slot_key, rule, source, source_document_id, source_quote, status, vfda_reviewed_at)
  values
    (office, 'SERVICES', '["Chiropractic adjustments", "Spinal decompression", "Massage therapy", "Rehab exercises"]',
     'card_import', doc1, 'We offer adjustments, decompression, massage and rehab.', 'needs_doctor', now()),
    (office, 'NOT_OFFERED', '["Acupuncture", "X-rays on site"]',
     'card_import', doc1, 'We do NOT do acupuncture or in-office X-rays.', 'needs_doctor', now()),
    (office, 'OFFICE_MISSION', '"Help every family in town live pain-free without drugs or surgery."',
     'card_import', doc1, 'Our mission: help every family live pain-free without drugs or surgery.', 'needs_doctor', now()),
    (office, 'GREETING', '"Thank you for calling Demo Spine & Wellness, this is [name], how can I help you today?"',
     'card_import', doc1, 'Answer: "Thank you for calling Demo Spine & Wellness, this is ___, how can I help?"', 'needs_doctor', now()),
    (office, 'ESCALATION_CONTACT', '"Dr. Demo by text"',
     'card_import', doc1, 'If stuck, text Dr. Demo.', 'needs_doctor', now()),
    (office, 'ESCALATION_CONTACT', '"Office manager (Pat) on Slack"',
     'card_import', doc2, 'Questions go to Pat, office manager, in Slack.', 'needs_doctor', now()),
    (office, 'OFFICE_HOURS', '"Mon, Wed, Fri 8-12 and 2-6; Tue 2-6; Thu closed."',
     'card_import', doc2, 'Hours: M/W/F 8-12 & 2-6, Tue 2-6, Thu closed', 'needs_doctor', now()),
    (office, 'OPENING_TASKS', '["Check voicemail and texts", "Confirm today''s appointments", "Print the day sheet"]',
     'card_import', doc2, 'Open: voicemail + texts, confirm today, print day sheet.', 'needs_doctor', now()),
    (office, 'CALLBACK_TIME', '"Within 1 hour during office hours."',
     'card_import', doc2, 'Call everyone back within the hour.', 'needs_doctor', now())
  on conflict (office_id, rule_slot_key, source_document_id) do update
    set rule = excluded.rule,
        source = 'card_import',
        source_quote = excluded.source_quote,
        status = 'needs_doctor',
        vfda_reviewed_at = excluded.vfda_reviewed_at,
        doctor_approved_by = null,
        doctor_approved_at = null;

  raise notice 'Demo card rules ready for the demo doctor.';
end $$;

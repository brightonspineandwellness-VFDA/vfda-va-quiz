-- DEMO ONLY: pretend the demo office uploaded two Trello card PDFs, they were
-- read, and VFDA reviewed most of the extracted rules. Lets you test the
-- doctor's steps and VFDA's review page without real PDFs or the Claude API.
--
-- Run after phase3b.sql, `npm run import:bank` and supabase/seed.sql.
-- Running it again resets the demo card rules (it never un-sends: if VFDA
-- already sent the rules to the doctor, that stays).
-- Fake data only: no real patients, logins or card numbers.
--
-- Then, as VFDA (Offices → Cards & rules for the demo office):
--   one rule still to review (no-show rule, partial); accept or reject it,
--   then "Send to doctor".
-- As the demo doctor, after that:
--   Confirm your rules   VA Onboarding & Basics (escalation contact is a question:
--                        the two PDFs disagree), Open & Close Daily List
--   Questions for you    rules the cards didn't cover, with VFDA suggestions
--                        where there is one (e.g. confirmation rule)
--   VFDA standards       pre-accepted

do $$
declare
  office uuid := '00000000-0000-4000-8000-000000000001';  -- Demo Spine & Wellness (FAKE)
  doc1   uuid := '00000000-0000-4000-8000-0000000000d1';
  doc2   uuid := '00000000-0000-4000-8000-0000000000d2';
begin
  if not exists (select 1 from public.offices where id = office) then
    raise exception 'The demo office is missing. Run supabase/seed.sql first.';
  end if;

  insert into public.office_documents (id, office_id, kind, file_path, file_name, card_name, imported_at, created_at)
  values
    (doc1, office, 'card', office || '/demo/onboarding-cards.pdf', 'VA Onboarding cards (FAKE).pdf', 'VA Onboarding',
     now(), now() - interval '1 minute'),
    (doc2, office, 'card', office || '/demo/daily-list-cards.pdf', 'Daily List cards (FAKE).pdf', 'Open & Close',
     now(), now() - interval '1 minute')
  on conflict (id) do update set card_name = excluded.card_name;

  -- Uploaded and read; VFDA's review comes next.
  update public.offices
  set cards_uploaded_at = coalesce(cards_uploaded_at, now()),
      extraction_status = 'done',
      extracted_at = now(),
      extraction_error = null
  where id = office;

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
     'card_import', doc2, 'Call everyone back within the hour.', 'needs_doctor', now()),
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

  raise notice 'Demo cards ready: review them as VFDA, then send to the doctor.';
end $$;

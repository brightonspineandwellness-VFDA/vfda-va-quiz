-- Practice days: every VA gets 10 quiz days (src/lib/practice-days.ts).
-- W2D3 / W2D4 / W2D5 skipped for the office are built as phone practice days
-- under their own code (office_days.kind 'skipped'). For a VA whose role
-- leaves out a day the office has, or who has no Phones role, these stand-in
-- days take the slot. They're not in settings.sequence, so no office gets
-- them unless one of its VAs needs them.
--   W2P3 / W2P4 / W2P5: phone practice 1 / 2 / 3 (VA's role leaves out the day)
--   W2W3 / W2W4 / W2W5: practice on the VA's weakest workflow (no Phones role)
--
-- Safe to run more than once.

-- Several days share a slot now (W2D3, W2P3, W2W3).
alter table public.schedule_days drop constraint if exists schedule_days_week_day_key;

insert into public.schedule_days (code, week, day, title, condition, answer_format, workflows, notes)
values
  ('W2P3', 2, 3, 'Phone practice 1: Everyday calls', 'always', 'say_do_book', '{WF04}',
   'Practice day: stands in for W2D3 when the VA''s role leaves it out.'),
  ('W2P4', 2, 4, 'Phone practice 2: Tricky calls', 'always', 'say_do_book', '{WF04,WF09}',
   'Practice day: stands in for W2D4 when the VA''s role leaves it out.'),
  ('W2P5', 2, 5, 'Phone practice 3: Mixed review', 'always', 'say_do_book', '{WF04,WF09}',
   'Practice day: stands in for W2D5 when the VA''s role leaves it out.'),
  ('W2W3', 2, 3, 'Workflow practice 1', 'always', 'steps_say_doc', '{}',
   'Practice day: stands in for W2D3 for a VA with no Phones role (their weakest workflow).'),
  ('W2W4', 2, 4, 'Workflow practice 2', 'always', 'steps_say_doc', '{}',
   'Practice day: stands in for W2D4 for a VA with no Phones role (their 2nd weakest workflow).'),
  ('W2W5', 2, 5, 'Workflow practice 3', 'always', 'steps_say_doc', '{}',
   'Practice day: stands in for W2D5 for a VA with no Phones role (their 3rd weakest workflow).')
on conflict (code) do update
  set title = excluded.title, answer_format = excluded.answer_format, workflows = excluded.workflows, notes = excluded.notes;

-- A practice day's name at the office ("Phone practice 1: Everyday calls",
-- "Practice: EHR documentation"), set when it's built.
alter table public.office_days add column if not exists title text;

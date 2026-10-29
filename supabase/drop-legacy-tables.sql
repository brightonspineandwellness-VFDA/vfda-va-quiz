-- OPTIONAL clean-up after phase2b.sql. Deletes the v1 tables that phase2b.sql
-- kept because they still had rows (renamed legacy_<name>): the Phase 2 quiz
-- bank, Phase 3 interview answers and gray cards, and any v1 quiz progress.
--
-- phase2b.sql already copied what v2 uses: clinics -> offices, interview
-- answers -> office_rules, gray cards -> office_workflows. What is lost here:
-- the v1 quiz bank (re-creatable from seed/quiz-bank.json) and click-path
-- answers (v2 has no click paths).
--
-- This can't be undone. Paste into the Supabase SQL Editor and run only when
-- you're sure. Running it again does nothing.

begin;

drop table if exists
  public.legacy_notifications,
  public.legacy_attempts,
  public.legacy_proof_uploads,
  public.legacy_unlocks,
  public.legacy_clinic_questions,
  public.legacy_clinic_quizzes,
  public.legacy_interview_answers,
  public.legacy_gray_cards,
  public.legacy_question_templates,
  public.legacy_quiz_templates,
  public.legacy_interview_questions,
  public.legacy_clinics;

commit;

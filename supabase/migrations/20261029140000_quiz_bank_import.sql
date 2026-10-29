-- Phase 2: changes needed to import seed/quiz-bank.json.
-- Safe to run more than once.

-- W2D5 Gray Cards has no fixed points: they're computed per office from its
-- gray cards (pass 80%, review 65-79%). So the three point columns may be null,
-- but only all together.
alter table public.quiz_templates alter column max_points drop not null;
alter table public.quiz_templates alter column pass_points drop not null;
alter table public.quiz_templates alter column review_min_points drop not null;

alter table public.quiz_templates drop constraint if exists quiz_templates_points_all_or_none;
alter table public.quiz_templates add constraint quiz_templates_points_all_or_none check (
  (max_points is null and pass_points is null and review_min_points is null)
  or (max_points is not null and pass_points is not null and review_min_points is not null)
);

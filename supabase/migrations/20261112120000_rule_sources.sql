-- Rule sources: for each graded item, whether the rule it was graded against
-- came from the office's card or from a VFDA standard (source vfda_default,
-- "VFDA standards", or the master bank with no card), and those VFDA
-- standard rules in plain words. Written when the item is graded
-- (src/lib/rule-sources.ts); the quiz reports show the "Some answers were
-- checked against VFDA standards" notice from it. Items graded before this
-- have none: the reports work it out from the scenario instead.
--
-- { "kind": "card" | "vfda_standard", "card": "<card name>" | null, "rules": ["No-show follow-up: ..."] }
--
-- Safe to run more than once.

alter table public.attempt_items add column if not exists rule_source jsonb;

-- Simpler office setup, and the scenario bank.
--
-- The doctor's setup is Profile, Upload your cards, VFDA standards: nobody
-- is asked about rules and VFDA doesn't review them. Rules read from the
-- cards apply at once (each card's own protocol to the scenarios built from
-- it); VFDA corrects a misread. Rules still waiting under the old flow are
-- accepted now.
--
-- "Share answer bank with doctor" (offices.share_answer_bank, off by
-- default): the office's doctors may view and download the scenario bank
-- with answers, read-only. VAs never see it.
--
-- Safe to run more than once.

update public.office_rules
   set status = 'accepted'
 where source = 'card_import'
   and status in ('proposed', 'needs_doctor');

alter table public.offices add column if not exists share_answer_bank boolean not null default false;

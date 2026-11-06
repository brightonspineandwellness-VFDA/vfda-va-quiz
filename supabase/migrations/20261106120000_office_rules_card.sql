-- The VA Office Rules card: VFDA's form card, where the doctor writes "Our
-- answer:" (or "VFDA default") under each of the 12 must-ask rules. Reading
-- it saves the doctor's own answers as accepted office rules with source
-- 'doctor_card' (no VFDA review; the doctor wrote them). Step 4 "Questions for
-- you" is then only asked for rules still blank.
--
-- Safe to run more than once.

alter table public.office_rules drop constraint if exists office_rules_source_check;
alter table public.office_rules add constraint office_rules_source_check
  check (source in ('card_import', 'doctor_card', 'doctor', 'vfda_default', 'vfda', 'auto'));

-- Quiz report alerts: an unusually fast finish is shown as time answering
-- vs. the typical time for those questions, saved when the quiz is finished.
-- Older attempts have neither (the report then says "well under the typical time").
--
-- Safe to run more than once.

alter table public.attempts add column if not exists answer_time  integer; -- seconds answering (sum of the items)
alter table public.attempts add column if not exists typical_time integer; -- seconds others usually take on those items

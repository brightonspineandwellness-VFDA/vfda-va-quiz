-- Test setup: one fake office plus an admin, a doctor and a VA.
--
-- How to use:
--   1. Run the database SQL first (phase1.sql, phase2.sql, then phase2b.sql).
--   2. Have each of the three test emails sign in once at /login, so Supabase
--      creates their account. They will see "Waiting for access" - that's expected.
--   3. Put the three emails below (replace the example addresses), then paste this
--      whole file into the Supabase SQL Editor and click Run.
--   4. Sign in again (or refresh): each person lands on their own page.
--
-- Safe to run more than once. If any email hasn't signed in yet, nothing is
-- changed and the error says which one.
-- Fake data only: never put real patient details here.

do $$
declare
  -- >>> EDIT THESE THREE LINES <<<
  admin_email  text := 'brightonspineandwellness+admin@gmail.com';
  doctor_email text := 'brightonspineandwellness+doctor@gmail.com';
  va_email     text := 'brightonspineandwellness+va@gmail.com';

  demo_office_id constant uuid := '00000000-0000-4000-8000-000000000001';
  addr text;
begin
  if lower(admin_email) = lower(doctor_email)
     or lower(admin_email) = lower(va_email)
     or lower(doctor_email) = lower(va_email) then
    raise exception 'Use three different email addresses.';
  end if;

  foreach addr in array array[admin_email, doctor_email, va_email] loop
    if addr like '%@example.com' then
      raise exception 'Replace the example address % with a real email you control.', addr;
    end if;
    if not exists (select 1 from auth.users u where lower(u.email) = lower(addr)) then
      raise exception '% has not signed in yet. Sign in once at /login, then run this again.', addr;
    end if;
  end loop;

  -- Profiles are created on first sign-in; this covers accounts made before the trigger existed.
  insert into public.profiles (id, email)
  select u.id, u.email from auth.users u
  where lower(u.email) in (lower(admin_email), lower(doctor_email), lower(va_email))
  on conflict (id) do nothing;

  insert into public.offices (id, name, status)
  values (demo_office_id, 'Demo Spine & Wellness (FAKE)', 'setup')
  on conflict (id) do nothing;

  update public.profiles
     set role = 'vfda_admin', office_id = null, full_name = 'Test VFDA Admin',
         va_start_date = null
   where lower(profiles.email) = lower(admin_email);

  update public.profiles
     set role = 'doctor', office_id = demo_office_id, full_name = 'Dr. Test Doctor',
         va_start_date = null
   where lower(profiles.email) = lower(doctor_email);

  update public.profiles
     set role = 'va', office_id = demo_office_id, full_name = 'Test VA',
         va_start_date = current_date
   where lower(profiles.email) = lower(va_email);

  raise notice 'Done: % is admin, % is doctor, % is VA at Demo Spine & Wellness (FAKE).',
    admin_email, doctor_email, va_email;
end $$;

-- Check the result:
select p.email, p.role, o.name as office, p.va_start_date
from public.profiles p
left join public.offices o on o.id = p.office_id
where p.role is not null
order by p.role;

-- Run in Supabase SQL editor AFTER schema.sql (which adds alerts.extra_emails).
-- KUL <-> URC return, depart 2027-06-13, return 2027-06-25, MYR per adult.
-- Target band MYR 1,800-2,300: alert fires at <= 2300 (anything under 1800 is an even better deal).
-- 4 travellers: Travelpayouts prices are per passenger, so the alert compares per-adult fare; multiply x4 for the group total.
-- The user below must already have signed in once (magic link) so a row exists in auth.users.
insert into public.alerts (user_id, origin, destination, depart_date, return_date, currency, target_price, condition,
                           sources, notify_email, notify_browser, extra_emails)
select id, 'KUL', 'URC', '2027-06-13', '2027-06-25', 'myr', 2300, '<=',
       array['travelpayouts'], true, true, array['ckm1268@gmail.com','lyn1268@gmail.com']
from auth.users
where email = 'ckm1268@gmail.com';   -- change to the account you log into the app with

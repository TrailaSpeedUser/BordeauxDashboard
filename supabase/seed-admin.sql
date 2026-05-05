-- Promote a user to admin. Run this AFTER the user has logged in once
-- (so the profiles row exists). Replace the email below.
update public.profiles
set role = 'admin'
where email = 'tobias.brack@traila.ch';

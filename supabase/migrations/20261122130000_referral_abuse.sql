-- Invite links, part 2: make self-invites detectable.
--
-- The first migration only knows an account id, so "invite yourself with a
-- second email" is invisible to it. These columns let the server compare the
-- person behind the account instead: a normalised email, a hash of the device
-- the link was opened on, and a hash of the connection it came from. They are
-- hashes on purpose — enough to compare, not a store of where anyone lives.
--
-- Run after 20261122120000_referrals.sql. Additive and idempotent, so it is
-- safe to run on a database that already has part 1.

alter table public.referral_codes
  add column if not exists email_norm  text,
  add column if not exists ip_hash     text,
  add column if not exists device_hash text;

alter table public.referrals
  add column if not exists invitee_email_norm  text,
  add column if not exists invitee_ip_hash     text,
  add column if not exists invitee_device_hash text;

-- Claims are checked against the inviter's signals on referral_codes, and the
-- invitee's are kept here so a later review can see what matched.
create index if not exists referrals_invitee_ip_idx on public.referrals (invitee_ip_hash);
create index if not exists referrals_code_idx on public.referrals (code);

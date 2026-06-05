-- Remove email-based accounts. The app no longer requires sign-in.
--
-- 1) Optional email is now transient: the address is stored on the job/intent
--    only long enough to send the completion links, then scrubbed (and the row
--    is hard-deleted at 24h regardless). It is never tied to an account.
-- 2) The users / sessions / otp_codes tables (and the user_id links) are dropped,
--    which also removes any email addresses retained from past sign-ins.

ALTER TABLE jobs ADD COLUMN notify_email TEXT;
ALTER TABLE upload_intents ADD COLUMN notify_email TEXT;

-- Drop session/OTP state first (sessions references users via FK).
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS otp_codes;

-- Indexes on user_id must go before the columns they cover can be dropped.
DROP INDEX IF EXISTS jobs_user_active_idx;
DROP INDEX IF EXISTS jobs_user_created_idx;
DROP INDEX IF EXISTS upload_intents_user_idx;

ALTER TABLE jobs DROP COLUMN user_id;
ALTER TABLE upload_intents DROP COLUMN user_id;

-- Finally drop the accounts table itself (and the stored emails).
DROP TABLE IF EXISTS users;

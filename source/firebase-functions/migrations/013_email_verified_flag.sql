-- 013_email_verified_flag.sql

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill TRUE for every existing profile so current users keep uninterrupted access
UPDATE profiles SET email_verified = TRUE WHERE email_verified IS FALSE;

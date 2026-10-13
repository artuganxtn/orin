-- Migration 008: Add full_name_encrypted to kyc_files and update status CHECK constraints

ALTER TABLE kyc_files
  ADD COLUMN IF NOT EXISTS full_name_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS full_name_iv TEXT,
  ADD COLUMN IF NOT EXISTS full_name_tag TEXT;

-- Drop old check constraints if exist
ALTER TABLE kyc_requests DROP CONSTRAINT IF EXISTS kyc_requests_status_check;
ALTER TABLE kyc_files DROP CONSTRAINT IF EXISTS kyc_files_status_check;

-- Add updated check constraints including review and more_information
ALTER TABLE kyc_requests ADD CONSTRAINT kyc_requests_status_check
  CHECK (status IN ('pending', 'review', 'approved', 'verified', 'rejected', 'more_information'));

ALTER TABLE kyc_files ADD CONSTRAINT kyc_files_status_check
  CHECK (status IN ('pending', 'review', 'approved', 'verified', 'rejected', 'more_information'));

GRANT SELECT, INSERT, UPDATE ON kyc_files, kyc_requests, kyc_access_log TO orin_app;

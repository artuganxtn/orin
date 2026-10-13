-- =====================================================================
-- MIGRATION 006: GRANT PRECISE APPLICATION PERMISSIONS TO orin_app
-- =====================================================================

GRANT UPDATE ON customer_registry, verified_customers, kyc_requests, referral_rewards, kyc_files, program_members, access_status, session_revocations, docs, program_configuration, staff TO orin_app;
GRANT UPDATE, DELETE ON contract_revocation_state TO orin_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orin_app;


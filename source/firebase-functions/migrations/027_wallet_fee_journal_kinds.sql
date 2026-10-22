-- =====================================================================
-- MIGRATION 027: ALLOW WALLET FEE JOURNAL KINDS
-- Fixes: new row for relation "journals" violates check constraint
--        "journals_kind_check" when transferring from Permanent Contracts
--        (العقود الدائمة) to Withdrawable Futures (العقود الآجلة) with the
--        20% early-transfer fee.
-- =====================================================================

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_kind_check;

ALTER TABLE journals ADD CONSTRAINT journals_kind_check CHECK (kind IN (
  'deposit',
  'allocation',
  'settlement',
  'adjustment',
  'referral_reward',
  'team_activity',
  'nonwithdrawable_bonus',
  'bonus_allocation',
  'bonus_settlement',
  'bonus_profit_unlock',
  'withdrawal',
  'bonus_expired',
  'early_exit_fee',
  'withdrawal_fee',
  'wallet_transfer'
));

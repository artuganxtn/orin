-- Compound invariant triggers are installed atomically through lib/invariants.ts
-- before account bootstrap. The hosting migration runner splits compound SQL.
SELECT 1;

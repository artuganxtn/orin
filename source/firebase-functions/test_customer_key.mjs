import assert from 'node:assert/strict';
import { computeCustomerKey, idLast4 } from './test-balance-bundle.mjs';

// 1. Verify throws if KYC_HMAC_SECRET is not set
delete process.env.KYC_HMAC_SECRET;
assert.throws(() => {
  computeCustomerKey('SA', 'passport', 'P12345678');
}, /KYC_HMAC_SECRET configuration required/);

// Set secret
process.env.KYC_HMAC_SECRET = 'live-server-kyc-master-secret-2026';

// 2. Normalization: strip spaces, hyphens, dots and case-insensitivity
const baseKey = computeCustomerKey('SA', 'passport', 'P12345678');
const variants = [
  computeCustomerKey(' sa ', 'Passport', ' P 1234 5678 '),
  computeCustomerKey('Sa', 'PASSPORT', 'p-1234-5678'),
  computeCustomerKey('SA', 'passport', ' P.1234.5678 '),
  computeCustomerKey('  SA  ', '  passport  ', '  P - 1234 . 5678  ')
];

for (const v of variants) {
  assert.equal(v, baseKey, 'Variant must match base key exactly');
}

// 3. Verify last 4 digits extraction
assert.equal(idLast4('P 1234 5678'), '5678');
assert.equal(idLast4('P-1234-5678'), '5678');
assert.equal(idLast4('p.1234.5678'), '5678');

console.log('All computeCustomerKey and idLast4 tests PASSED successfully!');

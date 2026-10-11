import { apiFetch } from '../lib/client-api';
import { ReferralServiceError, type ReferralTransport } from '../lib/referrals';

export function referralTransport(db: any, backend?: (path: string, init: RequestInit) => Promise<Response>): ReferralTransport {
  return {
    async load(uid) {
      const response = await (backend ? backend('/api/referrals', {}) : apiFetch('/api/referrals'));
      if (!response.ok) {
        throw new ReferralServiceError(
          response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'permission-denied' : 'unavailable',
          'backend'
        );
      }
      return await response.json();
    }
  };
}

export async function attributeReferral(db: any, uid: string, code: string) {
  if (!/^ORIN-[A-F0-9]{12}$/.test(code)) return;
  await apiFetch('/api/referrals/attribute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
}

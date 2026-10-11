import { createHash, randomUUID } from 'node:crypto';
import { adminApp as app, adminAuth as auth } from './firebase-admin-init.ts';

export { app, auth };
export const OWNER = 'khtaub7341@gmail.com';
export type Data = Record<string, any>;
export type Identity = {
  id: string;
  uid?: string;
  name?: string;
  email: string;
  verified?: boolean;
  authTime?: number;
  securitySessionId?: string;
  roles?: string[];
  role?: string;
};
export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const id = () => randomUUID();
export const owner = (u: Identity) => (u.verified ?? true) && u.email === OWNER;
export function active(profile: Data | undefined, u: Identity, admin = false) {
  if (!profile || profile.id !== u.id || profile.email !== u.email || profile.disabled)
    throw new ApiError('الوصول إلى الحساب غير متاح.', 403);
  if (admin && !(u.verified && (profile.role === 'admin' || owner(u))))
    throw new ApiError('هذه العملية للإدارة فقط.', 403);
  return profile;
}

import type {User} from 'firebase/auth';
export async function ensureAccountProfile(_db: any, user: User){
  try {
    const token = await user.getIdToken();
    if (token) {
      await fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
  } catch {}
}


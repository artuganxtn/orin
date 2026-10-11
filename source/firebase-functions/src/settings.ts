import { randomUUID, createHash } from 'node:crypto';
import { withTx } from './db.ts';
import {
  DEFAULT_CONFIGURATION,
  DEFAULT_PREFERENCES,
  CAPABILITIES,
  parsePreferences,
  type MarketConfiguration,
  type Preferences
} from '../../lib/preferences.js';
import { validatePreferences } from '../../lib/settings-engine.js';

export class SettingsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Identity = { id: string; email: string; name?: string; role?: string };
export type Data = Record<string, any>;

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export async function configuration() {
  return await withTx(async (client) => {
    const res = await client.query(
      "SELECT data, updated_at FROM docs WHERE collection = 'system' AND id = 'markets'"
    );
    if (res.rowCount && res.rows[0].data?.configuration) {
      return {
        configuration: res.rows[0].data.configuration as MarketConfiguration,
        configurationRevision: res.rows[0].data.revision || 1,
        updatedAt: new Date(res.rows[0].updated_at).getTime(),
        capabilities: CAPABILITIES
      };
    }
    return {
      configuration: structuredClone(DEFAULT_CONFIGURATION),
      configurationRevision: 1,
      updatedAt: Date.now(),
      capabilities: CAPABILITIES
    };
  });
}

export async function getSettings(u: Identity): Promise<Data> {
  const configData = await configuration();
  return await withTx(async (client) => {
    const pRes = await client.query('SELECT * FROM profiles WHERE id = $1', [u.id]);
    if (pRes.rowCount === 0) {
      throw new SettingsError('المستخدم غير موجود.', 404);
    }
    const profileRow = pRes.rows[0];

    const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND type = 'real' LIMIT 1", [u.id]);
    const accRow = accRes.rows[0] || {};

    const profileData = {
      displayName: profileRow.display_name || u.name || 'مستخدم ORIN',
      phone: profileRow.profile?.phone || '',
      country: profileRow.profile?.country || '',
      closureStatus: profileRow.profile?.closureStatus || 'open',
      role: profileRow.role || 'user',
      disabled: profileRow.disabled === true
    };

    const preferences = parsePreferences(
      { ...profileRow.preferences, ...accRow.preferences },
      configData.configuration
    );

    return {
      ...configData,
      preferences,
      profile: profileData,
      revision: accRow.revision || 1,
      updatedAt: new Date(profileRow.updated_at).getTime(),
      isAdmin: profileRow.role === 'admin',
      email: profileRow.email,
      clientId: u.id
    };
  });
}

export async function saveSettings(u: Identity, input: Data, now = Date.now()): Promise<Data> {
  if (typeof input !== 'object' || input === null) {
    throw new SettingsError('بيانات غير صالحة.', 400);
  }

  const allowedKeys = ['revision', 'preferences', 'profile', 'closeAccount'];
  for (const k of Object.keys(input)) {
    if (!allowedKeys.includes(k)) {
      throw new SettingsError('إعداد غير مسموح.', 400);
    }
  }

  const current = await getSettings(u);
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) {
    throw new SettingsError('تغيرت الإعدادات. أعد تحميل الصفحة.', 409);
  }

  const patch = input.preferences || {};
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    throw new SettingsError('إعدادات غير صالحة.', 400);
  }
  validatePreferences(patch, current.configuration);

  const preferences = parsePreferences(
    {
      ...current.preferences,
      ...patch,
      notificationEvents: {
        ...current.preferences.notificationEvents,
        ...(patch.notificationEvents || {})
      }
    },
    current.configuration
  );

  const profile = { ...current.profile };
  if (input.profile !== undefined) {
    if (typeof input.profile !== 'object' || Array.isArray(input.profile)) {
      throw new SettingsError('بيانات غير صالحة.', 400);
    }
    for (const [key, value] of Object.entries(input.profile)) {
      if (!['displayName', 'phone', 'country'].includes(key)) {
        throw new SettingsError('إعداد غير مسموح.', 400);
      }
      if (typeof value !== 'string') {
        throw new SettingsError('بيانات غير صالحة.', 400);
      }
      const text = value.trim();
      if (key === 'displayName' && (!text || text.length > 100)) {
        throw new SettingsError('تحقق من بيانات الحساب.', 400);
      }
      if (key === 'phone' && text !== '' && !/^\+?[0-9 ()-]{6,24}$/.test(text)) {
        throw new SettingsError('تحقق من بيانات الحساب.', 400);
      }
      if (key === 'country' && text !== '' && !/^[A-Z]{2}$/.test(text)) {
        throw new SettingsError('تحقق من بيانات الحساب.', 400);
      }
      profile[key] = text;
    }
  }

  if (input.closeAccount !== undefined) {
    if (input.closeAccount !== true) {
      throw new SettingsError('التأكيد مطلوب.', 400);
    }
    profile.closureStatus = 'requested';
  }

  return await withTx(async (client) => {
    // Update profiles table
    await client.query(
      `UPDATE profiles
       SET preferences = $1, profile = $2, display_name = $3, updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(preferences), JSON.stringify(profile), profile.displayName, u.id]
    );

    // Update accounts table revision
    await client.query(
      `UPDATE accounts
       SET revision = revision + 1, updated_at = NOW()
       WHERE user_id = $1 AND type = 'real'`,
      [u.id]
    );

    // Record audit event
    const action = input.closeAccount ? 'ACCOUNT_CLOSURE_REQUESTED' : 'PREFERENCES_UPDATED';
    const auditPayload = JSON.stringify({
      revision: current.revision + 1,
      fields: Object.keys(patch),
      profileFields: Object.keys(input.profile || {}),
      closureRequested: input.closeAccount === true
    });
    const payloadHash = hash(auditPayload);

    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (action, reference) DO NOTHING`,
      [u.id, action, u.id, auditPayload, payloadHash]
    );

    return {
      ...current,
      preferences,
      profile,
      revision: current.revision + 1,
      updatedAt: now
    };
  });
}

export async function saveConfiguration(u: Identity, input: Data, now = Date.now()) {
  if (u.role !== 'admin') {
    throw new SettingsError('هذه العملية للإدارة فقط.', 403);
  }

  return await withTx(async (client) => {
    const docRes = await client.query(
      "SELECT data FROM docs WHERE collection = 'system' AND id = 'markets'"
    );
    const existing = docRes.rows[0]?.data || { configuration: DEFAULT_CONFIGURATION, revision: 1 };

    if (input.revision !== undefined && input.revision !== existing.revision) {
      throw new SettingsError('تغيرت إعدادات الإدارة. أعد التحميل.', 409);
    }

    const nextConfig = {
      ...existing.configuration,
      ...(input.configuration || {})
    };

    const nextData = {
      configuration: nextConfig,
      revision: (existing.revision || 1) + 1,
      updatedAt: now
    };

    await client.query(
      `INSERT INTO docs (collection, id, data, updated_at)
       VALUES ('system', 'markets', $1::jsonb, NOW())
       ON CONFLICT (collection, id) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(nextData)]
    );

    return nextData;
  });
}

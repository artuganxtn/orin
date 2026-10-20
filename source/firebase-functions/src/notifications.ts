import { randomUUID } from 'node:crypto';
import { withTx } from './db.ts';
import { noticeCategory, noticeDestination } from '../../lib/notification-model.js';

export class NotificationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Identity = { id: string; email: string; name?: string; role?: string };
export type Data = Record<string, any>;

function visible(n: Data, uid: string, role: string | undefined, now: number) {
  const isAdmin = role === 'admin';
  const targetRole = n.target_role || (n.deep_link?.startsWith('/admin') ? 'admin' : null);

  // If notice is designated for admin:
  if (targetRole === 'admin' || n.category === 'admin' || n.user_id === 'admin') {
    return isAdmin;
  }

  // Hide legacy admin notices from normal users (even if user_id was stored as '*')
  if (!isAdmin) {
    if (n.deep_link && n.deep_link.startsWith('/admin')) return false;
    const title = String(n.title || '');
    if (title.includes('طلب سحب جديد') || title.includes('بانتظار الموافقة') || title.includes('سحب جديد')) {
      return false;
    }
  }

  // Target matching
  if (n.user_id === '*') {
    // Broadcast notices: non-admins only see general announcements or public campaigns
    if (!isAdmin && n.category !== 'announcement' && !n.audience) {
      return false;
    }
    return true;
  } else if (n.user_id === 'admin') {
    return isAdmin;
  } else if (n.user_id !== uid) {
    // Private notification meant for another user
    return false;
  }

  if (n.created_at > now) return false;
  if (n.expires_at !== null && n.expires_at !== undefined && n.expires_at <= now) return false;
  return true;
}

export async function inbox(u: Identity, now = Date.now(), offset = 0, key?: string) {
  return await withTx(async (client) => {
    const isAdmin = u.role === 'admin';

    // 1. Fetch user notifications from docs
    // Strictly isolate: each user only fetches their own notices (owner_id = u.id OR data->>'user_id' = u.id),
    // plus legitimate broadcast campaigns (user_id = '*' AND category = 'announcement').
    // Admins also fetch administrative notices.
    const noticeRows = await client.query(
      `SELECT id, data FROM docs
       WHERE collection = 'orinNotices'
         AND (
           owner_id = $1 
           OR data->>'user_id' = $1
           OR (data->>'user_id' = '*' AND ($2::boolean = true OR (data->>'category' = 'announcement' AND COALESCE(data->>'target_role', '') <> 'admin' AND COALESCE(data->>'deep_link', '') NOT LIKE '/admin%')))
           OR ($2::boolean = true AND (data->>'user_id' = 'admin' OR data->>'target_role' = 'admin' OR data->>'category' = 'admin' OR data->>'deep_link' LIKE '/admin%'))
         )
       ORDER BY updated_at DESC LIMIT 100`,
      [u.id, isAdmin]
    );

    // 2. Fetch user read states
    const readRows = await client.query(
      `SELECT id, data FROM docs
       WHERE collection = 'orinNoticeReads' AND owner_id = $1`,
      [u.id]
    );

    const readsMap = new Map<string, number>();
    for (const r of readRows.rows) {
      const noticeId = r.data?.notice_id || r.id.split(':')[1];
      if (noticeId) {
        readsMap.set(noticeId, r.data?.read_at || now);
      }
    }

    const items = noticeRows.rows
      .map(r => ({ id: r.id, ...(r.data || {}) }))
      .filter(n => visible(n, u.id, u.role, now))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .map(n => ({
        ...n,
        id: n.id,
        read_at: readsMap.get(n.id) ?? null,
        category: noticeCategory(n as any),
        deep_link: noticeDestination(n as any)
      }));

    const filtered = key ? items.filter(n => n.id === key) : items.slice(offset, offset + 50);
    const unreadCount = items.filter(n => n.read_at === null).length;

    return {
      items: filtered,
      unreadCount,
      total: items.length,
      serverTime: now,
      pushAvailable: false
    };
  });
}

export async function readNotices(u: Identity, input: Data, now = Date.now()) {
  return await withTx(async (client) => {
    if (input.all === true) {
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data, updated_at)
         VALUES ('orinUserSeen', $1, $1, $2::jsonb, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
        [u.id, JSON.stringify({ seen_at: now })]
      );
    } else {
      const noticeId = String(input.id || '').trim();
      if (!noticeId) {
        throw new NotificationError('معرّف الإشعار مطلوب.', 400);
      }
      const readKey = `${u.id}:${noticeId}`;
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data, updated_at)
         VALUES ('orinNoticeReads', $1, $2, $3::jsonb, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET data = $3::jsonb, updated_at = NOW()`,
        [readKey, u.id, JSON.stringify({ notice_id: noticeId, read_at: now })]
      );
    }

    return await inbox(u, now);
  });
}

export async function listCampaigns(u: Identity) {
  if (u.role !== 'admin') {
    throw new NotificationError('هذه العملية للإدارة فقط.', 403);
  }
  return await withTx(async (client) => {
    const res = await client.query(
      "SELECT id, data FROM docs WHERE collection = 'orinCampaigns' ORDER BY updated_at DESC LIMIT 100"
    );
    return {
      campaigns: res.rows.map(r => ({ id: r.id, ...(r.data || {}) })),
      pushAvailable: false,
      schedulerAvailable: false
    };
  });
}

export async function campaign(u: Identity, input: Data, now = Date.now()) {
  if (u.role !== 'admin') {
    throw new NotificationError('هذه العملية للإدارة فقط.', 403);
  }

  const operation = input.action || 'draft';
  const campaignId = String(input.id || 'camp-' + randomUUID());

  return await withTx(async (client) => {
    if (operation === 'draft') {
      const title = String(input.title || '').trim();
      const message = String(input.message || '').trim();
      if (!title || !message) {
        throw new NotificationError('عنوان ورسالة الحملة مطلوبان.', 400);
      }
      const data = {
        id: campaignId,
        title,
        message,
        audience: input.audience || 'all',
        status: 'draft',
        created_at: now,
        created_by: u.id
      };
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data, updated_at)
         VALUES ('orinCampaigns', $1, $2, $3::jsonb, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET data = $3::jsonb, updated_at = NOW()`,
        [campaignId, u.id, JSON.stringify(data)]
      );
      return { ok: true, campaign: data };
    }

    if (operation === 'send') {
      const cRes = await client.query(
        "SELECT data FROM docs WHERE collection = 'orinCampaigns' AND id = $1",
        [campaignId]
      );
      if (cRes.rowCount === 0) {
        throw new NotificationError('الحملة غير موجودة.', 404);
      }
      const camp = cRes.rows[0].data;

      // Broadcast notice to all users
      const noticeId = `camp-notice-${campaignId}`;
      const noticeData = {
        id: noticeId,
        user_id: '*',
        title: camp.title,
        message: camp.message,
        category: 'announcement',
        created_at: now,
        deep_link: '/notifications'
      };

      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data, updated_at)
         VALUES ('orinNotices', $1, NULL, $2::jsonb, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
        [noticeId, JSON.stringify(noticeData)]
      );

      camp.status = 'sent';
      camp.sent_at = now;
      await client.query(
        "UPDATE docs SET data = $1::jsonb, updated_at = NOW() WHERE collection = 'orinCampaigns' AND id = $2",
        [JSON.stringify(camp), campaignId]
      );

      return { ok: true, sent: true, campaignId };
    }

    throw new NotificationError('عملية غير مدعومة.', 400);
  });
}

export async function createNotice(client: any, opts: {
  userId: string;
  targetRole?: string;
  title: string;
  message: string;
  category?: string;
  deepLink?: string;
  now?: number;
}) {
  const noticeId = 'notif-' + randomUUID();
  const ts = opts.now || Date.now();
  const cat = opts.category === 'finance' ? 'financial' : (opts.category || 'financial');
  const targetRole = opts.targetRole || (opts.userId === 'admin' || opts.deepLink?.startsWith('/admin') ? 'admin' : undefined);
  const noticeData: Record<string, any> = {
    id: noticeId,
    user_id: opts.userId,
    title: opts.title,
    message: opts.message,
    category: cat,
    created_at: ts,
    deep_link: opts.deepLink || '/notifications'
  };
  if (targetRole) {
    noticeData.target_role = targetRole;
  }
  const ownerId = (opts.userId === '*' || opts.userId === 'admin') ? null : opts.userId;
  await client.query(
    `INSERT INTO docs (collection, id, owner_id, data, updated_at)
     VALUES ('orinNotices', $1, $2, $3::jsonb, NOW())
     ON CONFLICT (collection, id) DO UPDATE SET data = $3::jsonb, updated_at = NOW()`,
    [noticeId, ownerId, JSON.stringify(noticeData)]
  );
  return noticeData;
}


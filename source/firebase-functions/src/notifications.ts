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
  metadata?: Record<string, any>;
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
    deep_link: opts.deepLink || '/notifications',
    ...(opts.metadata ? { metadata: opts.metadata } : {})
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

export async function notifyWithdrawalSubmitted(client: any, p: {
  userId: string;
  wdId: string;
  amountCents: number;
  feeCents: number;
  netAmountCents: number;
  coin: string;
  address: string;
  userEmail?: string;
}) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const feeUsd = (p.feeCents / 100).toFixed(2);
  const netUsd = (p.netAmountCents / 100).toFixed(2);
  const shortAddr = p.address.length > 18 ? `${p.address.slice(0, 8)}...${p.address.slice(-6)}` : p.address;

  // 1. User notice (financial category, detailed breakdown)
  await createNotice(client, {
    userId: p.userId,
    title: 'طلب سحب قيد المراجعة والتدقيق ⏳',
    message: `تم استلام طلب السحب رقم (${p.wdId}) بقيمة ${amountUsd} USDT بنجاح.\n` +
             `• المبلغ المطلوب: ${amountUsd} USDT\n` +
             `• رسوم السحب (5%): ${feeUsd} USDT\n` +
             `• الصافي المستحق: ${netUsd} USDT (${p.coin})\n` +
             `• عنوان المحفظة: ${shortAddr}\n` +
             `الطلب قيد المراجعة والتحقق المالي من قِبل إدارة ORIN.`,
    category: 'financial',
    deepLink: '/withdraw',
    metadata: {
      type: 'withdrawal_submitted',
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      netAmountCents: p.netAmountCents,
      coin: p.coin,
      address: p.address,
      status: 'requested'
    }
  });

  // 2. Admin notice
  const email = p.userEmail || p.userId;
  await createNotice(client, {
    userId: 'admin',
    targetRole: 'admin',
    title: 'طلب سحب جديد بانتظار الاعتماد 🔔',
    message: `المستخدم ${email} قدم طلب سحب بقيمة ${amountUsd} USDT (${p.coin}) إلى العنوان ${shortAddr}. المعرّف: ${p.wdId}.`,
    category: 'financial',
    deepLink: '/admin/withdrawals',
    metadata: {
      type: 'admin_withdrawal_requested',
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      coin: p.coin,
      address: p.address
    }
  });
}

export async function notifyWithdrawalApproved(client: any, p: {
  userId: string;
  wdId: string;
  amountCents: number;
  netAmountCents: number;
  coin: string;
  address?: string;
}) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const netUsd = (p.netAmountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: 'تم اعتماد وموافقة طلب السحب ✅',
    message: `تمت مراجعة طلب السحب (${p.wdId}) والموافقة عليه بنجاح بقيمة ${amountUsd} USDT (${p.coin}).\n` +
             `صافي المبلغ (${netUsd} USDT) قيد الإرسال الفوري إلى محفظتك وسيزود بالـ TxID فور الاكتمال على البلوكتشين.`,
    category: 'financial',
    deepLink: '/activity',
    metadata: {
      type: 'withdrawal_approved',
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      netAmountCents: p.netAmountCents,
      coin: p.coin,
      status: 'approved'
    }
  });
}

export async function notifyWithdrawalPaid(client: any, p: {
  userId: string;
  wdId: string;
  amountCents: number;
  netAmountCents: number;
  coin: string;
  address?: string;
  txHash: string;
}) {
  const netUsd = (p.netAmountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: 'تم تنفيذ وتحويل السحب بنجاح 🚀',
    message: `تم تحويل مبلغ ${netUsd} USDT (${p.coin}) بنجاح إلى محفظتك.\n` +
             `معرّف العملية على البلوكتشين (TxID):\n${p.txHash}\n` +
             `تم تسوية المعاملة واكتمالها بنجاح في كشف الحساب.`,
    category: 'financial',
    deepLink: '/activity',
    metadata: {
      type: 'withdrawal_paid',
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      netAmountCents: p.netAmountCents,
      coin: p.coin,
      txHash: p.txHash,
      status: 'paid'
    }
  });
}

export async function notifyWithdrawalRejected(client: any, p: {
  userId: string;
  wdId: string;
  amountCents: number;
  coin: string;
  reason: string;
}) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: 'إشعار برفض طلب السحب وإعادة الرصيد ⚠️',
    message: `تم رفض طلب السحب (${p.wdId}).\n` +
             `السبب: ${p.reason || 'مرفوض من قبل التدقيق المالي'}.\n` +
             `تمت إعادة كامل المبلغ (${amountUsd} USDT) فوراً إلى رصيدك المتاح في العقود الآجلة (محفظة السحب).`,
    category: 'financial',
    deepLink: '/withdraw',
    metadata: {
      type: 'withdrawal_rejected',
      withdrawalId: p.wdId,
      amountCents: p.amountCents,
      reason: p.reason,
      status: 'rejected'
    }
  });
}

export async function notifyDepositCredited(client: any, p: {
  userId: string;
  amountCents: number;
  coin?: string;
  depositId?: string;
}) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  await createNotice(client, {
    userId: p.userId,
    title: 'تم تأكيد الإيداع وإضافة الرصيد بنجاح 💰',
    message: `تم تأكيد إيداع مبلغ ${amountUsd} USDT بنجاح وإضافته إلى محفظة العقود الآجلة الخاصة بك.\n` +
             `الرصيد جاهز الآن للتحويل إلى العقود الدائمة لبدء التداول الفوري.`,
    category: 'financial',
    deepLink: '/activity',
    metadata: {
      type: 'deposit_credited',
      amountCents: p.amountCents,
      depositId: p.depositId
    }
  });
}

export async function notifyTradeOpened(client: any, p: {
  userId: string;
  positionId: string;
  asset: string;
  direction: string;
  amountCents: number;
  durationSec: number;
}) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const dirAr = p.direction === 'BUY' ? 'شراء' : 'بيع';
  await createNotice(client, {
    userId: p.userId,
    title: `فتح صفقة تداول جديدة (${p.asset}) 📈`,
    message: `تم تخصيص ${amountUsd} USDT من رصيد العقود الدائمة (التداول) لصفقة ${dirAr} على أصل ${p.asset}.\nمدة العقد: ${p.durationSec} ثانية.`,
    category: 'opportunity',
    deepLink: '/activity',
    metadata: {
      type: 'trade_opened',
      positionId: p.positionId,
      asset: p.asset,
      direction: p.direction,
      amountCents: p.amountCents,
      durationSec: p.durationSec
    }
  });
}

export async function notifyTradeSettled(client: any, p: {
  userId: string;
  positionId: string;
  asset: string;
  direction: string;
  amountCents: number;
  resultCents: number;
}) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const resultUsd = (Math.abs(p.resultCents) / 100).toFixed(2);
  const isGain = p.resultCents >= 0;
  const returnedUsd = ((p.amountCents + p.resultCents) / 100).toFixed(2);

  await createNotice(client, {
    userId: p.userId,
    title: isGain ? `ربح مؤكد من صفقة ${p.asset} 🎉` : `تسوية صفقة ${p.asset}`,
    message: isGain
      ? `تمت تسوية الصفقة بنجاح وتحقيق أرباح بقيمة +${resultUsd} USDT!\nتم إرجاع رأس المال والأرباح بإجمالي ${returnedUsd} USDT مباشرة إلى رصيد العقود الدائمة (التداول).`
      : `تمت تسوية الصفقة بنتيجة (${p.resultCents < 0 ? '-' : ''}${resultUsd} USDT). تم تحديث رصيد العقود الدائمة تلقائياً.`,
    category: 'financial',
    deepLink: '/activity',
    metadata: {
      type: 'trade_settled',
      positionId: p.positionId,
      asset: p.asset,
      resultCents: p.resultCents,
      isGain
    }
  });
}

export async function notifyTransferCompleted(client: any, p: {
  userId: string;
  amountCents: number;
  feeCents?: number;
  netAmountCents?: number;
  from: string;
  to: string;
}) {
  const amountUsd = (p.amountCents / 100).toFixed(2);
  const isToWithdrawal = p.to === 'futures';
  const fromName = p.from === 'futures' ? 'العقود الآجلة (محفظة السحب)' : 'العقود الدائمة (محفظة التداول)';
  const toName = p.to === 'futures' ? 'العقود الآجلة (محفظة السحب)' : 'العقود الدائمة (محفظة التداول)';

  await createNotice(client, {
    userId: p.userId,
    title: isToWithdrawal ? 'تحويل ناجح إلى محفظة السحب 💳' : 'تحويل ناجح إلى محفظة التداول 📊',
    message: `تم تحويل ${amountUsd} USDT بنجاح من ${fromName} إلى ${toName}.\n` +
             (p.feeCents && p.feeCents > 0
               ? `• رسوم الانسحاب المبكر (20% قبل 29 يوماً): -${(p.feeCents / 100).toFixed(2)} USDT\n• المبلغ الصافي الواصل: ${((p.netAmountCents || (p.amountCents - p.feeCents)) / 100).toFixed(2)} USDT (جاهز ومتاح للسحب).`
               : (isToWithdrawal ? '• الرصيد متاح وجاهز للسحب الآن بدون رسوم تحويل.' : 'الرصيد متاح وجاهز لفتح الصفقات الآن.')),
    category: 'financial',
    deepLink: isToWithdrawal ? '/withdraw' : '/transfer',
    metadata: {
      type: 'contract_transfer',
      amountCents: p.amountCents,
      from: p.from,
      to: p.to
    }
  });
}



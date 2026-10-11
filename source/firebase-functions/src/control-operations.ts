import { randomUUID, createHash } from 'node:crypto';
import { withTx } from './db.ts';
export * from './withdrawals.ts';

export class ControlError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Identity = { id: string; email: string; name?: string; role?: string };
export type Data = Record<string, any>;

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export async function operationQueues(u: Identity, roles: unknown) {
  return await withTx(async (client) => {
    const [kycRes, apprRes, wdRes] = await Promise.all([
      client.query("SELECT COUNT(*) FROM kyc_requests WHERE status IN ('pending', 'review')"),
      client.query("SELECT COUNT(*) FROM approvals WHERE status = 'pending'"),
      client.query("SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'requested'")
    ]);

    const queues = [
      { id: 'kyc', module: 'kyc', label: 'طلبات هوية تنتظر المراجعة', count: Number(kycRes.rows[0].count) },
      { id: 'approvals', module: 'approvals', label: 'موافقات مالية معلّقة', count: Number(apprRes.rows[0].count) },
      { id: 'withdrawals', module: 'withdrawals', label: 'سحوبات تنتظر المراجعة', count: Number(wdRes.rows[0].count) }
    ];

    return queues;
  });
}

export async function readAudit(u: Identity, q: Data) {
  return await withTx(async (client) => {
    let query = 'SELECT id, actor_id AS "adminId", action, reference AS target, payload, payload_hash, created_at AS timestamp FROM audit';
    const params: any[] = [];
    const wheres: string[] = [];

    if (q.action) {
      params.push(q.action);
      wheres.push(`action = $${params.length}`);
    }
    if (q.adminId) {
      params.push(q.adminId);
      wheres.push(`actor_id = $${params.length}`);
    }
    if (q.target) {
      params.push(q.target);
      wheres.push(`reference = $${params.length}`);
    }

    if (wheres.length > 0) {
      query += ' WHERE ' + wheres.join(' AND ');
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

    const res = await client.query(query, params);
    return {
      rows: res.rows,
      nextCursor: null,
      asOf: Date.now()
    };
  });
}

export async function readTickets(u: Identity, q: Data) {
  return await withTx(async (client) => {
    const res = await client.query(
      "SELECT id, data FROM docs WHERE collection = 'orinControlTickets' ORDER BY updated_at DESC LIMIT 50"
    );
    return {
      rows: res.rows.map(r => ({ id: r.id, ...(r.data || {}) })),
      nextCursor: null,
      asOf: Date.now()
    };
  });
}

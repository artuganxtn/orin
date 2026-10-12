import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { withTx } from './db.ts';
import { ApiError, type Identity, type Data } from './store.ts';
import { computeCustomerKey, verifyKycCustomer, idLast4, getKycFilesKey, decryptAesGcm } from './kyc.ts';
import { proposeWithdrawalApproval, approveWithdrawal, markWithdrawalPaid } from './withdrawals.ts';
import { MARKET_SYMBOLS } from '../../lib/market-symbols.js';

export { computeCustomerKey };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export async function controlRead(u: Identity, module: string, q: Data = {}) {
  const limit = Math.min(Math.max(Number(q.limit || 50), 1), 100);
  const offset = Math.max(Number(q.cursor || 0), 0);
  const searchStr = String(q.search || '').trim().toLowerCase();
  const statusFilter = String(q.status || 'all').trim().toLowerCase();

  if (module === 'support-ai' || module === 'support') {
    return {
      rows: [{
        id: 'adam-ai',
        name: 'Adam AI Assistant',
        model: 'gemini-1.5-flash',
        status: 'active',
        locale: 'ar/en',
        updatedAt: Date.now()
      }],
      nextCursor: null,
      hasMore: false
    };
  }

  return await withTx(async (client) => {
    if (module === 'audit' || module === 'security') {
      let sql = 'SELECT id, actor_id AS "adminId", action, reference AS target, payload, payload_hash AS "payloadHash", created_at AS "createdAt" FROM audit';
      const wheres: string[] = [];
      const params: any[] = [];

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
      if (q.from) {
        params.push(new Date(Number(q.from)));
        wheres.push(`created_at >= $${params.length}`);
      }
      if (q.to) {
        params.push(new Date(Number(q.to)));
        wheres.push(`created_at <= $${params.length}`);
      }

      if (wheres.length > 0) {
        sql += ' WHERE ' + wheres.join(' AND ');
      }

      sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit + 1, offset);

      const res = await client.query(sql, params);
      const hasMore = res.rows.length > limit;
      const rows = res.rows.slice(0, limit).map(r => ({ ...r, createdAt: new Date(r.createdAt).getTime() }));

      return {
        rows,
        nextCursor: hasMore ? String(offset + limit) : null,
        hasMore
      };
    }

    if (module === 'dashboard' || module === 'overview') {
      const [uRes, dRes, wRes, cRes, aRes] = await Promise.all([
        client.query('SELECT COUNT(*) FROM profiles'),
        client.query("SELECT COUNT(*) FROM deposits WHERE status = 'waiting'"),
        client.query("SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'requested'"),
        client.query("SELECT COUNT(*) FROM contracts WHERE status = 'active'"),
        client.query("SELECT COUNT(*) FROM approvals WHERE status = 'pending'")
      ]);
      return {
        rows: [{
          id: 'dashboard-summary',
          usersCount: Number(uRes.rows[0].count),
          pendingDepositsCount: Number(dRes.rows[0].count),
          pendingWithdrawalsCount: Number(wRes.rows[0].count),
          activeContractsCount: Number(cRes.rows[0].count),
          pendingApprovalsCount: Number(aRes.rows[0].count),
          updatedAt: Date.now()
        }],
        nextCursor: null,
        hasMore: false
      };
    }

    if (module === 'users') {
      let sql = 'SELECT id, email, display_name AS "displayName", role, disabled, created_at AS "createdAt" FROM profiles';
      const wheres: string[] = [];
      const params: any[] = [];

      if (statusFilter !== 'all') {
        if (statusFilter === 'active') wheres.push('disabled = FALSE');
        else if (statusFilter === 'disabled' || statusFilter === 'suspended') wheres.push('disabled = TRUE');
        else { params.push(statusFilter); wheres.push(`role = $${params.length}`); }
      }

      if (searchStr) {
        params.push(`%${searchStr}%`);
        wheres.push(`(LOWER(display_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length} OR LOWER(id) LIKE $${params.length})`);
      }

      if (wheres.length > 0) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit + 1, offset);

      const res = await client.query(sql, params);
      const hasMore = res.rows.length > limit;
      const rows = res.rows.slice(0, limit).map(r => ({
        ...r,
        status: r.disabled ? 'disabled' : 'active',
        createdAt: new Date(r.createdAt).getTime()
      }));

      return {
        rows,
        nextCursor: hasMore ? String(offset + limit) : null,
        hasMore
      };
    }

    if (module === 'wallets') {
      let sql = `
        SELECT a.id, a.user_id AS "userId", p.email, p.display_name AS "displayName", a.id AS "accountId",
               a.account_number AS "accountNumber", a.type, a.balance_cents AS "cashCents",
               a.bonus_cents AS "bonusCents", a.bonus_profit_cents AS "profitCents"
        FROM accounts a
        LEFT JOIN profiles p ON a.user_id = p.id
      `;
      const wheres: string[] = [];
      const params: any[] = [];

      if (statusFilter !== 'all') {
        params.push(statusFilter);
        wheres.push(`a.type = $${params.length}`);
      }

      if (searchStr) {
        params.push(`%${searchStr}%`);
        wheres.push(`(LOWER(p.display_name) LIKE $${params.length} OR LOWER(p.email) LIKE $${params.length} OR LOWER(a.account_number) LIKE $${params.length})`);
      }

      if (wheres.length > 0) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit + 1, offset);

      const res = await client.query(sql, params);
      const hasMore = res.rows.length > limit;
      const rows = res.rows.slice(0, limit);

      return {
        rows,
        nextCursor: hasMore ? String(offset + limit) : null,
        hasMore
      };
    }

    let sql = '';
    if (module === 'staff') {
      sql = `SELECT s.user_id AS id, p.email, p.display_name AS "displayName", s.roles, s.status, s.valid_after AS "validAfter", s.created_at AS "createdAt" FROM staff s JOIN profiles p ON s.user_id = p.id ORDER BY s.created_at DESC`;
    } else if (module === 'kyc') {
      sql = `SELECT k.id, k.user_id AS "userId", p.display_name AS "fullName", p.email, k.country, k.document_type AS "documentType", k.status, k.created_at AS "createdAt", k.updated_at AS "updatedAt" FROM kyc_files k LEFT JOIN profiles p ON k.user_id = p.id ORDER BY k.created_at DESC`;
    } else if (module === 'accounts') {
      sql = `SELECT a.id, a.user_id AS "userId", p.email, a.account_number AS "accountNumber", a.type, a.currency, a.balance_cents AS "balanceCents", a.status, a.created_at AS "createdAt" FROM accounts a LEFT JOIN profiles p ON a.user_id = p.id ORDER BY a.created_at DESC`;
    } else if (module === 'deposits') {
      sql = `SELECT d.id, d.user_id AS "userId", p.email, d.account_id AS "accountId", d.amount_cents AS "amountCents", d.coin, d.pay_address AS "payAddress", d.status, d.credited, d.created_at AS "createdAt" FROM deposits d LEFT JOIN profiles p ON d.user_id = p.id ORDER BY d.created_at DESC`;
    } else if (module === 'withdrawals') {
      sql = `SELECT w.id, w.user_id AS "userId", p.email, w.amount_cents AS "amountCents", w.address, w.coin, w.status, w.created_at AS "createdAt" FROM withdrawal_requests w LEFT JOIN profiles p ON w.user_id = p.id ORDER BY w.created_at DESC`;
    } else if (module === 'approvals') {
      sql = `SELECT id, kind, reward_kind AS "rewardKind", user_id AS "userId", account_id AS "accountId", delta_cents AS "deltaCents", status, reason, requested_by AS "requestedBy", created_at AS "createdAt" FROM approvals ORDER BY created_at DESC`;
    } else if (module === 'trading') {
      sql = `SELECT pos.id, pos.user_id AS "userId", p.display_name AS "user", p.email, pos.contract_id AS "contractId", c.code AS "contractCode", c.asset, c.direction, pos.amount_cents AS "amountCents", pos.result_cents AS "resultCents", pos.status, pos.started_at AS "startedAt", pos.ends_at AS "endsAt" FROM positions pos LEFT JOIN profiles p ON pos.user_id = p.id LEFT JOIN contracts c ON pos.contract_id = c.id ORDER BY pos.started_at DESC`;
    } else if (module === 'contracts' || module === 'codes') {
      sql = `SELECT id, code, title, asset, direction, duration_sec AS "durationSec", settlement_bps AS "settlementBps", status, hash, created_at AS "createdAt" FROM contracts ORDER BY created_at DESC`;
    } else if (module === 'markets') {
      return { rows: MARKET_SYMBOLS.map((s, idx) => ({ id: s.pair, pair: s.pair, symbol: s.label, name: s.name, category: s.category, source: 'Coinbase / TradingView', enabled: true, order: idx + 1, updatedAt: Date.now() })), nextCursor: null, hasMore: false };
    } else if (module === 'bonus') {
      sql = `SELECT w.user_id AS "id", w.user_id AS "userId", p.email, w.account_id AS "accountId", a.bonus_cents AS "bonusCents", w.profit_limit_cents AS "profitLimitCents", w.claimed FROM bonus_wallets w LEFT JOIN profiles p ON w.user_id = p.id LEFT JOIN accounts a ON w.account_id = a.id ORDER BY w.created_at DESC`;
    } else if (module === 'referrals') {
      sql = `SELECT r.code AS "id", r.code, r.user_id AS "userId", p.email, r.created_at AS "createdAt" FROM referral_codes r LEFT JOIN profiles p ON r.user_id = p.id ORDER BY r.created_at DESC`;
    } else if (module === 'team') {
      sql = `SELECT m.user_id AS "id", m.user_id AS "userId", p.email, m.referral_code AS "referralCode", m.direct_count AS "directCount", m.team_count AS "teamCount", m.paid_cents AS "paidCents" FROM program_members m LEFT JOIN profiles p ON m.user_id = p.id ORDER BY m.created_at DESC`;
    } else if (module === 'agencies' || module === 'badges') {
      sql = `SELECT id, owner_id AS "userId", data, updated_at AS "updatedAt" FROM docs WHERE collection = '${module}' ORDER BY updated_at DESC`;
    } else if (module === 'notifications') {
      sql = `SELECT id, owner_id AS "ownerId", data, updated_at AS "updatedAt" FROM docs WHERE collection = 'orinNotices' ORDER BY updated_at DESC`;
    } else if (module === 'content' || module === 'configuration') {
      sql = `SELECT id, data, updated_at AS "updatedAt" FROM docs WHERE collection = 'system' ORDER BY updated_at DESC`;
    } else if (module === 'tickets') {
      sql = `SELECT id, owner_id AS "ownerId", data, updated_at AS "updatedAt" FROM docs WHERE collection = 'support_tickets' ORDER BY updated_at DESC`;
    } else {
      return { rows: [], nextCursor: null, hasMore: false };
    }

    const res = await client.query(sql + ` LIMIT ${limit + 1} OFFSET ${offset}`);
    const hasMore = res.rows.length > limit;
    let rows = res.rows.slice(0, limit);

    if (module === 'kyc') {
      rows = rows.map(r => ({ ...r, documentIds: [r.id], idNumber: '••••', createdAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now(), updatedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : Date.now() }));
    }

    if (searchStr) {
      rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(searchStr));
    }
    if (statusFilter !== 'all') {
      rows = rows.filter(r => r.status === statusFilter || r.type === statusFilter);
    }

    return {
      rows,
      nextCursor: hasMore ? String(offset + limit) : null,
      hasMore
    };
  });
}

export async function controlAction(u: Identity, input: Data) {
  const action = String(input.action || '');
  const target = String(input.target || '');
  const payload = input.data || {};
  const reason = String(input.reason ?? payload.reason ?? '').trim();
  const requestId = String(input.requestId || 'req-' + randomUUID());

  // 1. Contract Create
  if (action === 'contract.create') {
    const code = 'ORIN-' + randomBytes(6).toString('hex').toUpperCase();
    const hashVal = createHash('sha256').update(code + ':' + (payload.asset || 'BTCUSD') + ':' + (payload.direction || 'BUY') + ':' + (payload.settlementBps || 0)).digest('hex');
    return await withTx(async (client) => {
      const contractId = target || 'contract-' + randomUUID();
      await client.query(
        `INSERT INTO contracts (id, code, title, asset, direction, duration_sec, settlement_bps, status, opens_at, closes_at, eligibility, hash, admin_id, created_at, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', TO_TIMESTAMP($8/1000.0), TO_TIMESTAMP($9/1000.0), $10, $11, $12, NOW(), NOW())`,
        [contractId, code, payload.title || 'عقد تداول معتمد', payload.asset || 'BTCUSD', payload.direction || 'BUY', Number(payload.durationSec || 60), Number(payload.settlementBps || 0), Number(payload.opensAt || Date.now()), Number(payload.closesAt || Date.now() + 86400000), payload.eligibility || 'all', hashVal, u.id]
      );
      return { ok: true, contractId, code, status: 'active' };
    });
  }

  // 2. Contract Publish
  if (action === 'contract.publish') {
    const contractId = target || payload.contractId;
    return await withTx(async (client) => {
      const res = await client.query(
        `UPDATE contracts
         SET status = 'active', published_at = NOW(), admin_id = $1
         WHERE id = $2
         RETURNING id, status, published_at`,
        [u.id, contractId]
      );
      if (res.rowCount === 0) {
        throw new ApiError('Contract not found', 404);
      }
      return { ok: true, published: true, contractId, status: res.rows[0].status };
    });
  }

  // 3. Contract Revoke
  if (action === 'contract.revoke') {
    const contractId = target || payload.contractId;
    return await withTx(async (client) => {
      const res = await client.query(
        `UPDATE contracts
         SET status = 'cancelled'
         WHERE id = $1
         RETURNING id`,
        [contractId]
      );
      if (res.rowCount === 0) {
        throw new ApiError('Contract not found', 404);
      }
      await client.query(
        `INSERT INTO contract_revocation_state (contract_id, revoked, reason, revoked_by, revoked_at)
         VALUES ($1, TRUE, $2, $3, NOW())
         ON CONFLICT (contract_id) DO UPDATE SET revoked = TRUE, reason = $2, revoked_by = $3, revoked_at = NOW()`,
        [contractId, reason, u.id]
      );
      return { ok: true, revoked: true, contractId };
    });
  }

  // 4. Account Balance / Finance Propose
  if (action === 'account.balance' || action === 'account.adjust' || action === 'finance.propose') {
    const rawTarget = String(target || payload.accountId || payload.uid || payload.userId || '');

    return await withTx(async (client) => {
      const accRes = await client.query(
        "SELECT id, user_id, balance_cents, reserved_cents, type FROM accounts WHERE id = $1 OR user_id = $1 ORDER BY (CASE WHEN type = 'real' THEN 0 ELSE 1 END) ASC LIMIT 1 FOR UPDATE",
        [rawTarget]
      );
      if (accRes.rowCount === 0) throw new ApiError('Account not found for user', 404);
      const acc = accRes.rows[0];
      const realAccountId = acc.id;
      const realUserId = acc.user_id;

      await client.query(
        `INSERT INTO profiles (id, email, display_name)
         VALUES ($1, $2, 'User')
         ON CONFLICT (id) DO NOTHING`,
        [realUserId, `${realUserId}@orin.test`]
      );

      const beforeCents = Number(acc.balance_cents);

      let deltaCents = 0;
      if (payload.balance !== undefined && payload.balance !== null && payload.balance !== '') {
        const targetCents = Math.round(Number(payload.balance) * 100);
        deltaCents = targetCents - beforeCents;
      } else {
        deltaCents = Number(payload.deltaCents || payload.amountCents || 0);
      }

      if (!Number.isSafeInteger(deltaCents)) {
        throw new ApiError('Valid balance adjustment required', 400);
      }

      if (deltaCents === 0) {
        return { ok: true, status: 'approved', deltaCents: 0, beforeCents, afterCents: beforeCents };
      }

      const afterCents = beforeCents + deltaCents;
      if (afterCents < Number(acc.reserved_cents)) {
        throw new ApiError('Adjustment would breach reserved balance', 409);
      }

      const reference = String(payload.reference || 'adj-ref-' + randomUUID());
      const approvalId = requestId.startsWith('req-') ? requestId.replace('req-', 'appr-') : 'appr-' + requestId;

      await client.query(
        `INSERT INTO approvals (id, kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, created_at)
         VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW())`,
        [approvalId, realUserId, realAccountId, deltaCents, beforeCents, afterCents, reason, reference, u.id]
      );

      return { ok: true, approvalId, status: 'pending', deltaCents, beforeCents, afterCents };
    });
  }

  // 5. Market Save
  if (action === 'market.save') {
    const payloadData = JSON.stringify(payload);
    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('system', 'markets', $1, $2::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [u.id, payloadData]
      );
      return { ok: true, saved: true };
    });
  }

  // 6. Staff Set
  if (action === 'staff.set') {
    const staffUid = String(target || payload._target || payload.userId || '');
    if (!staffUid) {
      throw new ApiError('Target staff user ID required', 400);
    }

    if (staffUid === u.id) {
      throw new ApiError('Caller cannot change their own staff roles', 409);
    }

    const requestedRoles = Array.isArray(payload.roles) ? payload.roles as any[] : [payload.roles || 'support'];
    const status = (payload.status === 'disabled' || payload.status === 'suspended') ? 'disabled' : 'active';

    return await withTx(async (client) => {
      const pRes = await client.query('SELECT id, role, disabled FROM profiles WHERE id = $1', [staffUid]);
      if (pRes.rowCount === 0) {
        throw new ApiError('Target user profile not found', 404);
      }

      const callerStaffRes = await client.query("SELECT roles FROM staff WHERE user_id = $1 AND status = 'active'", [u.id]);
      const callerRoles: string[] = callerStaffRes.rowCount && Array.isArray(callerStaffRes.rows[0].roles)
        ? callerStaffRes.rows[0].roles
        : (u.role === 'admin' ? ['super_admin'] : []);

      if (!callerRoles.includes('super_admin')) {
        for (const r of requestedRoles) {
          if (!callerRoles.includes(r)) {
            throw new ApiError(`Caller cannot grant role '${r}' because caller does not hold it`, 403);
          }
        }
      }

      const currentStaffRes = await client.query("SELECT roles, status FROM staff WHERE user_id = $1", [staffUid]);
      const isTargetSuperAdmin = currentStaffRes.rowCount > 0 &&
        Array.isArray(currentStaffRes.rows[0].roles) &&
        currentStaffRes.rows[0].roles.includes('super_admin') &&
        currentStaffRes.rows[0].status === 'active';

      const willBeSuperAdmin = status === 'active' && requestedRoles.includes('super_admin');

      if (isTargetSuperAdmin && !willBeSuperAdmin) {
        const superCountRes = await client.query(
          "SELECT COUNT(*) FROM staff WHERE roles @> '[\"super_admin\"]'::jsonb AND status = 'active'"
        );
        const superCount = Number(superCountRes.rows[0].count);
        if (superCount <= 1) {
          throw new ApiError('The last super_admin cannot be removed or disabled', 409);
        }
      }

      await client.query(
        `INSERT INTO staff (user_id, roles, status, valid_after, created_at)
         VALUES ($1, $2::jsonb, $3, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET roles = EXCLUDED.roles, status = EXCLUDED.status, valid_after = NOW()`,
        [staffUid, JSON.stringify(requestedRoles), status]
      );

      await client.query(
        `INSERT INTO session_revocations (user_id, valid_after, updated_at)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET valid_after = NOW(), updated_at = NOW()`,
        [staffUid]
      );

      const auditPayload = JSON.stringify({ staffUid, roles: requestedRoles, status, updatedBy: u.id });
      await client.query(
        `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
         VALUES ($1, 'STAFF_ROLE_SET', $2, $3::jsonb, $4)
         ON CONFLICT (action, reference) DO NOTHING`,
        [u.id, staffUid + '-' + Date.now(), auditPayload, hash(auditPayload)]
      );

      return { ok: true, staffUid, roles: requestedRoles, status };
    });
  }

  // 7. Notification Save / Publish
  if (action === 'notification.save' || action === 'notification.publish') {
    const noticeId = target || 'notice-' + randomUUID();
    const noticeData = JSON.stringify({ ...payload, status: action === 'notification.publish' ? 'published' : 'draft', updated_at: Date.now() });
    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('orinNotices', $1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [noticeId, u.id, noticeData]
      );
      return { ok: true, noticeId, status: action === 'notification.publish' ? 'published' : 'draft' };
    });
  }

  // 8. Content Save / Publish
  if (action === 'content.save' || action === 'content.publish') {
    const slug = target || payload._target || 'banner';
    const contentData = JSON.stringify({ ...payload, status: action === 'content.publish' ? 'published' : 'draft', updated_at: Date.now() });
    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('orinPublicContent', $1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [slug, u.id, contentData]
      );
      return { ok: true, slug, status: action === 'content.publish' ? 'published' : 'draft' };
    });
  }

  // 9. Configuration Save
  if (action === 'configuration.save') {
    const configData = JSON.stringify({ ...payload, updated_at: Date.now() });
    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('system', 'control_configuration', $1, $2::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [u.id, configData]
      );
      return { ok: true, saved: true };
    });
  }

  // 10. Program Configure
  if (action === 'program.configure') {
    const configData = JSON.stringify(payload);
    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO program_configuration (key, revision, config, updated_at)
         VALUES ('current', 1, $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET revision = program_configuration.revision + 1, config = EXCLUDED.config, updated_at = NOW()`,
        [configData]
      );
      return { ok: true, configured: true };
    });
  }

  // 11. Badge Grant
  if (action === 'badge.grant') {
    const badgeId = String(payload.badge || 'verified');
    const badgeData = JSON.stringify({ badge: badgeId, evidence: payload.evidenceReference || null, grantedAt: Date.now() });
    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('badges', $1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [target || 'badge-' + randomUUID(), u.id, badgeData]
      );
      return { ok: true, granted: true, badgeId };
    });
  }

  // 11b. Agency Set
  if (action === 'agency.set') {
    const agencyUid = target || payload.userId || payload.uid;
    if (!agencyUid) {
      throw new ApiError('Agency user ID required', 400);
    }
    const granted = payload.granted === true || payload.granted === 'true' || payload.granted === 'on';

    return await withTx(async (client) => {
      const agencyData = JSON.stringify({ agencyGranted: granted, name: payload.name || 'وكالة معتمدة', updatedAt: Date.now() });
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('agencies', $1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [agencyUid, u.id, agencyData]
      );
      return { ok: true, agencyUid, agencyGranted: granted };
    });
  }

  // 11c. Referral Review
  if (action === 'referral.review') {
    const refTarget = target || payload.referralId || payload.id;
    if (!refTarget) {
      throw new ApiError('Referral target or ID required', 400);
    }
    const status = String(payload.status || 'qualified');

    return await withTx(async (client) => {
      await client.query(
        `UPDATE referral_rewards SET status = $1 WHERE referrer_user_id = $2 OR referred_user_id = $2`,
        [status, refTarget]
      );
      return { ok: true, status, referralId: refTarget };
    });
  }

  // 12. Security Revoke
  if (action === 'security.revoke') {
    const revUid = target || payload.uid || payload.userId;
    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO session_revocations (user_id, valid_after, updated_at)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET valid_after = NOW(), updated_at = NOW()`,
        [revUid]
      );
      return { ok: true, revoked: true, userId: revUid };
    });
  }

  // 12b. Account Delete (Safe Close)
  if (action === 'account.delete') {
    const uid = String(payload.uid || payload.userId || target);
    const accountId = String(payload.accountId || target);

    return await withTx(async (client) => {
      let targetAccId = accountId;
      const accRes = await client.query('SELECT id, user_id, balance_cents, reserved_cents, status FROM accounts WHERE id = $1 OR user_id = $1 ORDER BY type ASC LIMIT 1 FOR UPDATE', [accountId]);
      if (accRes.rowCount === 0) throw new ApiError('Account not found', 404);
      const acc = accRes.rows[0];
      targetAccId = acc.id;

      if (Number(acc.balance_cents) !== 0) {
        throw new ApiError(`Cannot close account with non-zero balance ($${(Number(acc.balance_cents)/100).toFixed(2)}). Debit balance to zero first via approved finance action.`, 409);
      }

      await client.query("UPDATE positions SET status = 'settled', settled_at = NOW() WHERE account_id = $1 AND status = 'active'", [targetAccId]);
      await client.query("UPDATE accounts SET status = 'closed', updated_at = NOW() WHERE id = $1", [targetAccId]);
      await client.query("UPDATE profiles SET disabled = TRUE, updated_at = NOW() WHERE id = $1", [acc.user_id]);
      await client.query("INSERT INTO session_revocations (user_id, valid_after, updated_at) VALUES ($1, NOW(), NOW()) ON CONFLICT (user_id) DO UPDATE SET valid_after = NOW(), updated_at = NOW()", [acc.user_id]);

      return { ok: true, closed: true, accountId: targetAccId, userId: acc.user_id };
    });
  }

  // 12c. Support Tickets (ticket.create, ticket.update, ticket.note)
  if (action === 'ticket.create') {
    const ticketId = target || 'spt-' + randomUUID();
    const ticketData = JSON.stringify({
      id: ticketId,
      uid: payload.uid || target,
      title: payload.title || 'تذكرة دعم من الإدارة',
      description: payload.description || '',
      category: payload.category || 'account',
      priority: payload.priority || 'normal',
      status: 'open',
      assigneeId: payload.assigneeId || u.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    return await withTx(async (client) => {
      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('support_tickets', $1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [ticketId, payload.uid || target || u.id, ticketData]
      );
      return { ok: true, ticketId, status: 'open' };
    });
  }

  if (action === 'ticket.update') {
    const ticketId = target || payload.ticketId;
    return await withTx(async (client) => {
      const tRes = await client.query("SELECT data FROM docs WHERE collection = 'support_tickets' AND id = $1", [ticketId]);
      if (tRes.rowCount === 0) throw new ApiError('Ticket not found', 404);
      const prevData = tRes.rows[0].data || {};
      const updatedData = JSON.stringify({
        ...prevData,
        status: payload.status || prevData.status || 'in_progress',
        priority: payload.priority || prevData.priority || 'normal',
        assigneeId: payload.assigneeId !== undefined ? payload.assigneeId : prevData.assigneeId,
        dueAt: payload.dueAt || prevData.dueAt,
        updatedAt: Date.now()
      });

      await client.query(
        `UPDATE docs SET data = $1::jsonb, updated_at = NOW() WHERE collection = 'support_tickets' AND id = $2`,
        [updatedData, ticketId]
      );
      return { ok: true, ticketId, status: payload.status || prevData.status };
    });
  }

  if (action === 'ticket.note') {
    const ticketId = target || payload.ticketId;
    const bodyText = String(payload.body || '').trim();
    if (!bodyText) throw new ApiError('Note body is required', 400);

    return await withTx(async (client) => {
      const noteId = 'note-' + randomUUID();
      const noteData = JSON.stringify({
        id: noteId,
        ticketId,
        authorId: u.id,
        body: bodyText,
        createdAt: Date.now()
      });

      await client.query(
        `INSERT INTO docs (collection, id, owner_id, data)
         VALUES ('support_ticket_notes', $1, $2, $3::jsonb)`,
        [noteId, u.id, noteData]
      );
      return { ok: true, noteId, ticketId };
    });
  }

  // 13. Reward Propose (reward.propose)
  if (action === 'reward.propose') {
    const rawTarget = String(target || payload.accountId || payload.uid || payload.userId || '');
    const amountCents = Number(payload.amountCents || payload.deltaCents || 0);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new ApiError('Valid reward amount required', 400);
    }
    const reference = String(payload.reference || 'rew-ref-' + randomUUID());

    return await withTx(async (client) => {
      const accRes = await client.query(
        "SELECT id, user_id, balance_cents FROM accounts WHERE id = $1 OR user_id = $1 ORDER BY (CASE WHEN type = 'real' THEN 0 ELSE 1 END) ASC LIMIT 1 FOR UPDATE",
        [rawTarget]
      );
      if (accRes.rowCount === 0) throw new ApiError('Account not found', 404);
      const acc = accRes.rows[0];
      const realAccountId = acc.id;
      const realUserId = acc.user_id;

      await client.query(
        `INSERT INTO profiles (id, email, display_name)
         VALUES ($1, $2, 'User')
         ON CONFLICT (id) DO NOTHING`,
        [realUserId, `${realUserId}@orin.test`]
      );

      const beforeCents = Number(acc.balance_cents);
      const afterCents = beforeCents + amountCents;
      const approvalId = requestId.startsWith('req-') ? requestId.replace('req-', 'rew-appr-') : 'rew-appr-' + requestId;

      await client.query(
        `INSERT INTO approvals (id, kind, reward_kind, user_id, account_id, delta_cents, before_cents, after_cents, status, reason, reference, requested_by, created_at)
         VALUES ($1, 'referral_reward', 'referral', $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW())`,
        [approvalId, realUserId, realAccountId, amountCents, beforeCents, afterCents, reason, reference, u.id]
      );

      return { ok: true, approvalId, status: 'pending', amountCents };
    });
  }

  // 14. Finance Approve (finance.approve / reward.approve)
  if (action === 'finance.approve' || action === 'reward.approve') {
    const approvalId = target || payload.approvalId;
    return await withTx(async (client) => {
      const apprRes = await client.query(
        'SELECT * FROM approvals WHERE id = $1 FOR UPDATE',
        [approvalId]
      );
      if (apprRes.rowCount === 0) throw new ApiError('Approval record not found', 404);
      const appr = apprRes.rows[0];

      if (appr.status !== 'pending') {
        throw new ApiError(`Approval is not pending (status: ${appr.status})`, 409);
      }

      if (appr.requested_by === u.id) {
        throw new ApiError('Self-approval blocked: two-person rule requires distinct reviewer', 409);
      }

      const deltaCents = Number(appr.delta_cents);
      const uid = appr.user_id;
      const accountId = appr.account_id;
      const kind = appr.kind;
      const journalId = 'jnl-' + randomUUID();
      const sysBucket = kind === 'adjustment' ? 'system:adjustment' : 'system:referral_rewards';

      await client.query(
        `INSERT INTO journals (id, kind, reference, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [journalId, kind, appr.reference]
      );

      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
         VALUES ($1, $2, $3, 'cash', $4),
                ($1, NULL, NULL, $5, $6)`,
        [journalId, uid, accountId, deltaCents, sysBucket, -deltaCents]
      );

      await client.query(
        `UPDATE approvals
         SET status = 'approved', approved_by = $1, approved_at = NOW()
         WHERE id = $2`,
        [u.id, approvalId]
      );

      return { ok: true, status: 'approved', approvalId, journalId };
    });
  }

  // 15. Finance Reject (finance.reject)
  if (action === 'finance.reject' || action === 'reward.reject') {
    const approvalId = target || payload.approvalId;
    return await withTx(async (client) => {
      const res = await client.query(
        `UPDATE approvals
         SET status = 'rejected', approved_by = $1, approved_at = NOW()
         WHERE id = $2 AND status = 'pending'
         RETURNING id`,
        [u.id, approvalId]
      );
      if (res.rowCount === 0) throw new ApiError('Pending approval not found', 404);
      return { ok: true, status: 'rejected', approvalId };
    });
  }

  // 16. Deposit Review Resolve (payment.review)
  if (action === 'payment.review' || action === 'deposit.resolve') {
    const depositId = target || payload.depositId;
    const decision = payload.decision || (action === 'deposit.resolve' ? 'approve' : 'reject');

    return await withTx(async (client) => {
      const depRes = await client.query('SELECT * FROM deposits WHERE id = $1 FOR UPDATE', [depositId]);
      if (depRes.rowCount === 0) throw new ApiError('Deposit not found', 404);
      const dep = depRes.rows[0];

      await client.query(
        `UPDATE payment_reviews
         SET status = (CASE WHEN $1 = 'approve' THEN 'resolved' ELSE 'rejected' END),
             resolved_by = $2, resolved_at = NOW()
         WHERE deposit_id = $3 AND status = 'pending'`,
        [decision, u.id, depositId]
      );

      if (decision === 'approve' && !dep.credited) {
        const amount = Number(dep.amount_cents);
        const journalId = 'jnl-dep-resolve-' + randomUUID();

        await client.query(
          `INSERT INTO journals (id, kind, reference, created_at)
           VALUES ($1, 'deposit', $2, NOW())`,
          [journalId, `review-resolve-${depositId}`]
        );

        await client.query(
          `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
           VALUES ($1, $2, $3, 'cash', $4),
                  ($1, NULL, NULL, 'system:deposits', $5)`,
          [journalId, dep.user_id, dep.account_id, amount, -amount]
        );

        await client.query(
          `UPDATE deposits
           SET status = 'confirmed', credited = TRUE, credited_cents = $1, updated_at = NOW()
           WHERE id = $2`,
          [amount, depositId]
        );
      } else if (decision === 'reject') {
        await client.query(
          `UPDATE deposits
           SET status = 'failed', review_reason = $1, updated_at = NOW()
           WHERE id = $2`,
          [reason, depositId]
        );
      }

      return { ok: true, decision, depositId };
    });
  }

  // 17. User Status Restrict / Suspend (user.status)
  if (action === 'user.status') {
    const userId = target || payload.userId;
    const status = String(payload.status || 'restricted');

    return await withTx(async (client) => {
      await client.query(
        `UPDATE profiles
         SET disabled = ($1 = 'suspended'), updated_at = NOW()
         WHERE id = $2`,
        [status, userId]
      );

      await client.query(
        `INSERT INTO access_status (user_id, status, reason, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = NOW()`,
        [userId, status, reason]
      );

      return { ok: true, status, userId };
    });
  }

  // 18. KYC Review (kyc.review - searching by kyc_requests, kyc_files, or user_id)
  if (action === 'kyc.review') {
    const reqTarget = target || payload.requestId || payload.target;
    const inputStatus = String(payload.status || '');

    if (!['approved', 'verified', 'rejected', 'more_information', 'revoke'].includes(inputStatus)) {
      throw new ApiError('حالة المراجعة غير صالحة. / Invalid KYC review status.', 400);
    }

    if ((inputStatus === 'rejected' || inputStatus === 'more_information') && (!reason || reason.trim().length < 5)) {
      throw new ApiError('سبب المراجعة / رفض الطلب مطلوب بحد أدنى 5 أحرف. / Review reason (min 5 chars) is required.', 400);
    }

    const isApproved = inputStatus === 'approved' || inputStatus === 'verified';
    const isMoreInfo = inputStatus === 'more_information';
    const isRevoke = inputStatus === 'revoke';

    return await withTx(async (client) => {
      let kycUserId: string | null = null;
      let kycFileId: string | null = null;

      const reqRes = await client.query('SELECT user_id, customer_key FROM kyc_requests WHERE id = $1 OR customer_key = $1 OR user_id = $1', [reqTarget]);
      if (reqRes.rowCount) {
        kycUserId = reqRes.rows[0].user_id;
      } else {
        const fileRes = await client.query('SELECT id, user_id FROM kyc_files WHERE id = $1 OR user_id = $1 ORDER BY created_at DESC LIMIT 1', [reqTarget]);
        if (fileRes.rowCount) {
          kycUserId = fileRes.rows[0].user_id;
          kycFileId = fileRes.rows[0].id;
        } else {
          throw new ApiError('KYC request not found', 404);
        }
      }

      if (!kycFileId && kycUserId) {
        const fRes = await client.query('SELECT id FROM kyc_files WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [kycUserId]);
        if (fRes.rowCount) kycFileId = fRes.rows[0].id;
      }

      if (kycFileId) {
        const logCheck = await client.query('SELECT id FROM kyc_access_log WHERE staff_id = $1 AND kyc_file_id = $2 LIMIT 1', [u.id, kycFileId]);
        if (logCheck.rowCount === 0) {
          throw new ApiError('يجب معاينة الوثائق وتمرير سبب الوصول أولاً قبل مراجعة الطلب. / Prior document access log entry required before reviewing KYC request.', 403);
        }
      }

      let customerKey = 'ck-' + kycUserId;
      let last4 = '0000';
      const kFileRes = await client.query('SELECT * FROM kyc_files WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [kycUserId]);
      if (kFileRes.rowCount) {
        const kFile = kFileRes.rows[0];
        const encKey = getKycFilesKey();
        if (kFile.id_number_encrypted && kFile.id_number_iv && kFile.id_number_tag) {
          const realIdNum = decryptAesGcm(kFile.id_number_encrypted, kFile.id_number_iv, kFile.id_number_tag, encKey);
          customerKey = computeCustomerKey(kFile.country, kFile.document_type, realIdNum);
          last4 = idLast4(realIdNum);
        }
      }

      if (isApproved) {
        const regRes = await client.query('SELECT user_id FROM customer_registry WHERE customer_key = $1', [customerKey]);
        if (regRes.rowCount > 0 && regRes.rows[0].user_id !== kycUserId) {
          throw new ApiError('وثيقة الهوية هذه مسجلة بالفعل لحساب آخر. / Duplicate identity document detected.', 409);
        }

        await client.query(
          `INSERT INTO customer_registry (customer_key, user_id)
           VALUES ($1, $2)
           ON CONFLICT (customer_key) DO NOTHING`,
          [customerKey, kycUserId]
        );
      }

      const reqStatus = isApproved ? 'approved' : isMoreInfo ? 'more_information' : 'rejected';
      const fileStatus = isApproved ? 'verified' : isMoreInfo ? 'more_information' : 'rejected';

      await client.query(
        `UPDATE kyc_requests
         SET status = $1, reviewer_id = $2, reason = $3, reviewed_at = NOW()
         WHERE user_id = $4`,
        [reqStatus, u.id, reason, kycUserId]
      );

      await client.query(
        `UPDATE kyc_files
         SET status = $1, updated_at = NOW()
         WHERE user_id = $2`,
        [fileStatus, kycUserId]
      );

      if (isApproved) {
        const eventId = 'kyc-approved-' + randomUUID();
        await client.query(
          `INSERT INTO verified_customers (user_id, customer_key, id_number_last4, verified, revoked, event_id, created_at)
           VALUES ($1, $2, $3, TRUE, FALSE, $4, NOW())
           ON CONFLICT (user_id) DO UPDATE SET customer_key = EXCLUDED.customer_key, id_number_last4 = EXCLUDED.id_number_last4, verified = TRUE, revoked = FALSE, event_id = EXCLUDED.event_id`,
          [kycUserId, customerKey, last4, eventId]
        );
      } else if (isRevoke) {
        await client.query(
          `UPDATE verified_customers SET verified = FALSE, revoked = TRUE WHERE user_id = $1`,
          [kycUserId]
        );
        await client.query("UPDATE kyc_requests SET status = 'rejected', reason = $1, reviewed_at = NOW() WHERE user_id = $2", [reason, kycUserId]);
        await client.query("UPDATE kyc_files SET status = 'rejected', updated_at = NOW() WHERE user_id = $1", [kycUserId]);
      }

      return { ok: true, status: fileStatus, requestId: reqTarget, userId: kycUserId };
    });
  }

  // 19. Customer Verify
  if (action === 'customer.verify') {
    return await verifyKycCustomer(u, payload);
  }

  // 20. Withdrawal Propose / Approve / Pay
  if (action === 'withdrawal.propose') {
    return await proposeWithdrawalApproval(u, payload);
  }
  if (action === 'withdrawal.approve') {
    return await approveWithdrawal(u, payload);
  }
  if (action === 'withdrawal.pay') {
    return await markWithdrawalPaid(u, payload);
  }

  throw new ApiError(`Control action ${action} not implemented on server yet`, 501);
}

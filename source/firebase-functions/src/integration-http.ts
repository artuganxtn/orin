import { Router, type Request, type Response, type NextFunction, type Express } from 'express';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { adminApp } from './firebase-admin-init.ts';
import { withTx } from './db.ts';
import { permissionsFor, type Permission } from '../../lib/control-center.js';
import { getActiveFinancialPolicy } from './financial-policy.ts';

const SCOPES = ['account:read', 'balance:read', 'transactions:read', 'kyc:status', 'policy:read'] as const;
type Scope = typeof SCOPES[number];
type Session = { uid: string; token: DecodedIdToken; staffPermissions: Permission[] };
type Key = { id: string; scopes: Scope[] };
type IntegrationRequest = Request & { integrationSession?: Session };
class IntegrationError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

function config() {
  const tenant = String(process.env.ORIN_INTEGRATION_TENANT_ID || '').trim();
  const auditSecret = String(process.env.ORIN_INTEGRATION_AUDIT_SECRET || '');
  const configured = /^[a-z0-9][a-z0-9_-]{2,63}$/.test(tenant) && auditSecret.length >= 32;
  return { tenant, auditSecret, configured, enabled: configured && process.env.ORIN_INTEGRATION_ENABLED === 'true' };
}
function requireEnabled() {
  const c = config();
  if (!c.enabled) throw new IntegrationError(503, 'integration_disabled');
  return c;
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function pseudonym(value: string) { return createHmac('sha256', config().auditSecret).update(value).digest('hex'); }
function noStore(_req: Request, res: Response, next: NextFunction) {
  res.set({ 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  next();
}
function handle(fn: (req: IntegrationRequest, res: Response) => Promise<unknown>) {
  return (req: IntegrationRequest, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
}

/** This boundary deliberately does NOT use the legacy auth middleware: that
 * middleware may provision profiles/accounts. Integration reads never do so.
 * No test token, email allowlist, caller-supplied UID or API key grants identity. */
async function verifySession(req: IntegrationRequest, firebaseTenant = process.env.ORIN_INTEGRATION_FIREBASE_TENANT_ID?.trim()): Promise<Session> {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new IntegrationError(503, 'identity_verification_unavailable');
  const authorization = req.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_.-]{100,8192}$/.test(authorization)) throw new IntegrationError(401, 'verified_session_required');
  let token: DecodedIdToken;
  try {
    const auth = getAuth(adminApp);
    token = firebaseTenant
      ? await auth.tenantManager().authForTenant(firebaseTenant).verifyIdToken(authorization.slice(7), true)
      : await auth.verifyIdToken(authorization.slice(7), true);
    if (!firebaseTenant && token.firebase?.tenant) throw new Error('tenant_mismatch');
  } catch {
    throw new IntegrationError(401, 'verified_session_required');
  }
  const session = await withTx(async client => {
    const result = await client.query(
      `SELECT p.disabled, p.email_verified, a.status AS access_status,
        r.valid_after, s.roles, s.status AS staff_status, s.valid_after AS staff_valid_after
       FROM profiles p
       LEFT JOIN access_status a ON a.user_id = p.id
       LEFT JOIN session_revocations r ON r.user_id = p.id
       LEFT JOIN staff s ON s.user_id = p.id WHERE p.id = $1`, [token.uid]
    );
    const row = result.rows[0];
    if (!row || row.disabled || (row.access_status && row.access_status !== 'active')) throw new IntegrationError(403, 'account_unavailable');
    if (!token.email_verified && row.email_verified !== true) throw new IntegrationError(403, 'verified_email_required');
    // A refreshed token has a new iat but retains the old sign-in auth_time.
    // Refreshing a revoked app session must not restore integration access.
    if (!Number.isFinite(token.auth_time) || !Number.isFinite(token.iat)) throw new IntegrationError(401, 'verified_session_required');
    if (row.valid_after && token.auth_time < Math.floor(new Date(row.valid_after).getTime() / 1000)) throw new IntegrationError(401, 'session_revoked');
    const staffFresh = !row.staff_valid_after || token.auth_time >= Math.floor(new Date(row.staff_valid_after).getTime() / 1000);
    return { uid: token.uid, token, staffPermissions: row.staff_status === 'active' && staffFresh ? permissionsFor(row.roles) : [] };
  });
  req.integrationSession = session;
  return session;
}
function requireStaff(session: Session, permissions: Permission[], recent = false) {
  if (!permissions.every(p => session.staffPermissions.includes(p))) throw new IntegrationError(403, 'staff_permission_required');
  if (recent && (Date.now() / 1000 - session.token.auth_time > 300 || session.token.auth_time > Date.now() / 1000 + 30)) {
    throw new IntegrationError(401, 'recent_sign_in_required');
  }
}

/** Guard for explicitly selected existing staff-only endpoints. Deliberately
 * independent of integration enablement, namespace, audit secret and API keys.
 * The existing ORIN deployment uses its default Firebase project identity. */
export function strictStaffGuard(required: Permission[], recent = true) {
  return (req: IntegrationRequest, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'private, no-store');
    void (async () => {
      const session = await verifySession(req, '');
      requireStaff(session, required, recent);
    })().then(() => next(), (error: unknown) => {
      const known = error instanceof IntegrationError;
      const code = known ? error.code : 'identity_verification_unavailable';
      const status = known ? error.status : 503;
      console.warn(JSON.stringify({ event: 'staff_boundary_rejected', code, status }));
      res.status(status).json({ error: code });
    });
  };
}

async function audit(actor: string, keyId: string | null, action: string, outcome: string) {
  await withTx(async client => {
    await client.query(
      `INSERT INTO integration_audit (id, tenant_id, actor_hash, key_id, action, outcome) VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), config().tenant, pseudonym(actor), keyId, action, outcome]
    );
  });
}
async function rateLimit(subject: string, limit: number) {
  const allowed = await withTx(async client => {
    const result = await client.query(
      `INSERT INTO integration_rate_limits (subject_hash, window_start, hits) VALUES ($1, date_trunc('minute', NOW()), 1)
       ON CONFLICT (subject_hash) DO UPDATE SET
         hits = CASE WHEN integration_rate_limits.window_start < date_trunc('minute', NOW()) THEN 1 ELSE integration_rate_limits.hits + 1 END,
         window_start = date_trunc('minute', NOW()) RETURNING hits`, [pseudonym(subject)]
    );
    return result.rows[0].hits <= limit;
  });
  if (!allowed) throw new IntegrationError(429, 'rate_limited');
}
async function verifyKey(req: Request): Promise<Key> {
  const c = requireEnabled();
  const raw = req.get('X-Orin-Integration-Key') || '';
  const match = /^orin_ro_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(match[1])) {
    throw new IntegrationError(401, 'invalid_integration_key');
  }
  return await withTx(async client => {
    const result = await client.query(
      `SELECT id, secret_hash, scopes FROM integration_keys
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL AND expires_at > NOW()`, [match[1], c.tenant]
    );
    const row = result.rows[0];
    const expected = Buffer.from(row?.secret_hash || '0'.repeat(64), 'hex');
    const supplied = Buffer.from(hash(raw), 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied) || !row) throw new IntegrationError(401, 'invalid_integration_key');
    if (!Array.isArray(row.scopes) || row.scopes.some((s: unknown) => !SCOPES.includes(s as Scope))) throw new IntegrationError(403, 'invalid_key_scope');
    return { id: row.id, scopes: row.scopes };
  });
}
function requireScope(key: Key, scope: Scope) {
  if (!key.scopes.includes(scope)) throw new IntegrationError(403, 'scope_required');
}
type Lookup = { kind: 'account' | 'email' | 'transaction'; value: string };
function parseLookup(body: unknown): Lookup {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IntegrationError(400, 'invalid_lookup');
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some(k => !['kind', 'value'].includes(k)) || typeof b.kind !== 'string' || !['account', 'email', 'transaction'].includes(b.kind) || typeof b.value !== 'string') throw new IntegrationError(400, 'invalid_lookup');
  const value = b.value.trim();
  if (!value || value.length > (b.kind === 'email' ? 320 : 128) || /[\u0000-\u001f]/.test(value)) throw new IntegrationError(400, 'invalid_lookup');
  if (b.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new IntegrationError(400, 'invalid_lookup');
  return { kind: b.kind as Lookup['kind'], value: b.kind === 'email' ? value.toLowerCase() : value };
}

/** Explicit projection only. Never use controlRead('user'), SELECT p.*, docs
 * payloads, OTPs, password data, KYC images or security-token tables here. */
async function readProjection(ownerId: string, lookup: Lookup, scopes: Scope[]) {
  return await withTx(async client => {
    if (lookup.kind === 'transaction') {
      const result = await client.query(
        `SELECT 'deposit' AS kind, id, amount_cents, coin, status, created_at, credited FROM deposits
         WHERE user_id = $1 AND (id = $2 OR payment_id = $2)
         UNION ALL
         SELECT 'withdrawal' AS kind, id, amount_cents, coin, status, created_at, NULL::boolean AS credited FROM withdrawal_requests
         WHERE user_id = $1 AND (id = $2 OR tx_hash = $2)
         UNION ALL
         SELECT 'position' AS kind, id, amount_cents, NULL::varchar AS coin, status, started_at AS created_at, NULL::boolean AS credited FROM positions
         WHERE user_id = $1 AND id = $2 LIMIT 5`, [ownerId, lookup.value]
      );
      if (!result.rowCount) throw new IntegrationError(404, 'record_unavailable');
      return { transactions: result.rows.map(row => ({ kind: row.kind, id: row.id, amountCents: String(row.amount_cents), coin: row.coin, status: row.status, createdAt: row.created_at, ...(row.kind === 'deposit' ? { credited: row.credited } : {}) })) };
    }
    const result = await client.query(
      `SELECT a.id, a.account_number, a.type, a.currency, a.status
       FROM accounts a JOIN profiles p ON p.id = a.user_id
       WHERE a.user_id = $1 AND (($2 = 'account' AND (a.id = $3 OR a.account_number = $3))
         OR ($2 = 'email' AND LOWER(TRIM(p.email)) = $3)) ORDER BY a.created_at ASC LIMIT 20`,
      [ownerId, lookup.kind, lookup.value]
    );
    if (!result.rowCount) throw new IntegrationError(404, 'record_unavailable');
    const accounts = [];
    for (const row of result.rows) {
      const account: Record<string, unknown> = { id: row.id, accountNumber: row.account_number, type: row.type, currency: row.currency, status: row.status };
      if (scopes.includes('balance:read')) {
        const balance = await client.query(
          `SELECT a.balance_cents, a.reserved_cents, a.bonus_cents, a.bonus_profit_cents,
            d.data->'wallet'->>'perpetualCents' AS trading_cents
           FROM accounts a LEFT JOIN docs d ON d.collection = 'contract_wallets' AND d.id = a.id AND d.owner_id = a.user_id
           WHERE a.id = $1 AND a.user_id = $2`, [row.id, ownerId]
        );
        const b = balance.rows[0];
        const cash = BigInt(b.balance_cents);
        const rawTrading = /^\d+$/.test(String(b.trading_cents ?? '0')) ? BigInt(b.trading_cents ?? '0') : null;
        const trading = rawTrading === null ? null : rawTrading > cash ? cash : rawTrading;
        account.balance = {
          cashCents: String(cash), reservedCents: String(b.reserved_cents), bonusCents: String(b.bonus_cents), bonusProfitCents: String(b.bonus_profit_cents),
          ...(row.type === 'real' ? { tradingPocketCents: trading === null ? null : String(trading), withdrawalPocketCents: trading === null ? null : String(cash - trading) } : {}),
          withdrawalEligibility: 'not_determined'
        };
      }
      accounts.push(account);
    }
    const output: Record<string, unknown> = { accounts };
    if (scopes.includes('kyc:status')) {
      const result = await client.query('SELECT verified, revoked FROM verified_customers WHERE user_id = $1', [ownerId]);
      output.kyc = { verified: result.rows[0]?.verified === true && result.rows[0]?.revoked !== true };
    }
    return output;
  });
}

async function resolveStaffOwner(lookup: Lookup) {
  return await withTx(async client => {
    const result = await client.query(
      `SELECT p.id FROM profiles p WHERE
        ($1 = 'email' AND LOWER(TRIM(p.email)) = $2) OR
        ($1 = 'account' AND EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = p.id AND (a.id = $2 OR a.account_number = $2))) OR
        ($1 = 'transaction' AND (
          EXISTS (SELECT 1 FROM deposits d WHERE d.user_id = p.id AND (d.id = $2 OR d.payment_id = $2)) OR
          EXISTS (SELECT 1 FROM withdrawal_requests w WHERE w.user_id = p.id AND (w.id = $2 OR w.tx_hash = $2)) OR
          EXISTS (SELECT 1 FROM positions x WHERE x.user_id = p.id AND x.id = $2))) LIMIT 2`, [lookup.kind, lookup.value]
    );
    if (result.rowCount !== 1) throw new IntegrationError(404, 'record_unavailable');
    return String(result.rows[0].id);
  });
}

/** Register BEFORE the legacy /api router, after JSON body parsing. */
export function registerIntegrationRoutes(app: Express) {
  const customer = Router();
  customer.use(noStore);
  customer.use((req, _res, next) => {
    void (async () => { requireEnabled(); await rateLimit(`ip:${req.ip || 'unknown'}`, 90); })().then(() => next(), next);
  });
  customer.use((req, _res, next) => { void verifySession(req).then(() => next(), next); });
  customer.post('/lookup', handle(async (req, res) => {
    const session = req.integrationSession!;
    const key = await verifyKey(req);
    const lookup = parseLookup(req.body);
    requireScope(key, lookup.kind === 'transaction' ? 'transactions:read' : 'account:read');
    await rateLimit(`key:${key.id}`, 120);
    await rateLimit(`owner:${key.id}:${session.uid}`, 30);
    try {
      const data = await readProjection(session.uid, lookup, key.scopes);
      await audit(session.uid, key.id, `customer_${lookup.kind}`, 'allowed');
      res.json({ ok: true, data });
    } catch (error) {
      await audit(session.uid, key.id, `customer_${lookup.kind}`, 'denied');
      throw error;
    }
  }));
  customer.get('/policy', handle(async (req, res) => {
    const key = await verifyKey(req);
    requireScope(key, 'policy:read');
    await rateLimit(`key:${key.id}`, 120);
    await audit(req.integrationSession!.uid, key.id, 'policy_read', 'allowed');
    res.json({ ok: true, policy: await getActiveFinancialPolicy() });
  }));

  const admin = Router();
  admin.use(noStore);
  admin.use((req, _res, next) => { void verifySession(req).then(() => next(), next); });
  admin.get('/status', handle(async (req, res) => {
    requireStaff(req.integrationSession!, ['configuration.manage', 'staff.manage']);
    const c = config();
    res.json({ enabled: c.enabled, configured: c.configured, tenant: c.tenant || null, availableScopes: SCOPES, externalConnectionStatus: 'not_verified', identityLinkRequired: true });
  }));
  admin.get('/keys', handle(async (req, res) => {
    requireStaff(req.integrationSession!, ['configuration.manage', 'staff.manage']);
    const c = requireEnabled();
    await rateLimit(`staff:${req.integrationSession!.uid}`, 30);
    const keys = await withTx(async client => (await client.query(
      'SELECT id, label, scopes, expires_at, revoked_at, created_at FROM integration_keys WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100', [c.tenant]
    )).rows);
    res.json({ keys });
  }));
  admin.post('/keys', handle(async (req, res) => {
    const session = req.integrationSession!;
    requireStaff(session, ['configuration.manage', 'staff.manage'], true);
    const c = requireEnabled();
    await rateLimit(`staff_create:${session.uid}`, 5);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['label', 'scopes', 'expiresAt'].includes(k))) throw new IntegrationError(400, 'invalid_key_request');
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const expiresAt = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
    if (!label || label.length > 80 || /[\u0000-\u001f]/.test(label) || !Number.isFinite(expiresAt) || expiresAt < Date.now() + 60000 || expiresAt > Date.now() + 90 * 86400000) throw new IntegrationError(400, 'invalid_key_request');
    if (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > SCOPES.length || body.scopes.some((s: unknown) => !SCOPES.includes(s as Scope))) throw new IntegrationError(400, 'invalid_key_scope');
    const scopes = [...new Set(body.scopes)] as Scope[];
    if (scopes.some(s => ['balance:read', 'kyc:status'].includes(s)) && !scopes.includes('account:read')) throw new IntegrationError(400, 'account_scope_required');
    const id = randomUUID();
    // Executed only by an explicitly invoked, enabled, recently authenticated
    // staff action. No key is seeded or generated at import/startup/migration.
    const secret = `orin_ro_${id}.${randomBytes(32).toString('base64url')}`;
    await withTx(async client => {
      await client.query(
        'INSERT INTO integration_keys (id, tenant_id, label, secret_hash, scopes, expires_at, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
        [id, c.tenant, label, hash(secret), JSON.stringify(scopes), new Date(expiresAt), session.uid]
      );
      await client.query(
        'INSERT INTO integration_audit (id, tenant_id, actor_hash, key_id, action, outcome) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), c.tenant, pseudonym(session.uid), id, 'key_created', 'allowed']
      );
    });
    res.status(201).json({ id, label, scopes, expiresAt: new Date(expiresAt).toISOString(), secret, shownOnce: true });
  }));
  admin.post('/keys/:id/revoke', handle(async (req, res) => {
    const session = req.integrationSession!;
    requireStaff(session, ['configuration.manage', 'staff.manage'], true);
    const c = requireEnabled();
    await rateLimit(`staff:${session.uid}`, 30);
    const id = String(req.params.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new IntegrationError(400, 'invalid_key_id');
    await withTx(async client => {
      const changed = await client.query('UPDATE integration_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, c.tenant]);
      if (!changed.rowCount) throw new IntegrationError(404, 'record_unavailable');
      await client.query('INSERT INTO integration_audit (id, tenant_id, actor_hash, key_id, action, outcome) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), c.tenant, pseudonym(session.uid), id, 'key_revoked', 'allowed']);
    });
    res.json({ ok: true });
  }));
  admin.post('/lookup', handle(async (req, res) => {
    const session = req.integrationSession!;
    requireEnabled();
    requireStaff(session, ['users.read', 'accounts.read']);
    const lookup = parseLookup(req.body);
    if (lookup.kind === 'transaction') requireStaff(session, ['finance.read', 'trading.read']);
    await rateLimit(`staff_lookup:${session.uid}`, 30);
    const scopes: Scope[] = ['account:read'];
    if (session.staffPermissions.includes('wallet.read')) scopes.push('balance:read');
    if (session.staffPermissions.includes('kyc.read')) scopes.push('kyc:status');
    try {
      const owner = await resolveStaffOwner(lookup);
      const data = await readProjection(owner, lookup, scopes);
      await audit(session.uid, null, `staff_${lookup.kind}`, 'allowed');
      res.json({ ok: true, data });
    } catch (error) {
      await audit(session.uid, null, `staff_${lookup.kind}`, 'denied');
      throw error;
    }
  }));
  const notFound = (_req: Request, res: Response) => res.status(404).json({ error: 'route_unavailable' });
  const errors = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const known = error instanceof IntegrationError;
    // Do not log exception messages, URLs, request bodies/headers or identifiers.
    console.warn(JSON.stringify({ event: 'integration_rejected', code: known ? error.code : 'integration_unavailable', status: known ? error.status : 503 }));
    if (known && error.status === 429) res.set('Retry-After', '60');
    res.status(known ? error.status : 503).json({ error: known ? error.code : 'integration_unavailable' });
  };
  customer.use(notFound); customer.use(errors);
  admin.use(notFound); admin.use(errors);
  app.use('/api/integration/v1', customer);
  app.use('/api/integration-admin', admin);
}

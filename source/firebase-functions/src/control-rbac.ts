import { type Request, type Response, type NextFunction } from 'express';
import { withTx } from './db.ts';
import { ROLES, PERMISSIONS, ACTION_PERMISSIONS, type Permission, type StaffRole } from '../../lib/control-center.js';

const ALL_PERMISSIONS: Permission[] = [
  'support.ai.read', 'support.ai.configure', 'support.knowledge.manage', 'support.knowledge.publish',
  'dashboard.read', 'users.read', 'users.manage',
  'kyc.read', 'kyc.documents', 'kyc.review',
  'accounts.read', 'accounts.manage', 'wallet.read',
  'finance.read', 'finance.propose', 'finance.approve',
  'trading.read', 'contracts.manage', 'markets.manage',
  'programs.read', 'programs.configure',
  'referrals.review', 'agencies.manage', 'badges.grant',
  'notifications.manage', 'content.manage', 'content.publish',
  'configuration.manage', 'security.read', 'security.revoke',
  'staff.manage', 'audit.read', 'reports.export', 'tickets.read', 'tickets.manage', 'tickets.assign'
];

const MODULE_PERMISSIONS: Record<string, Permission> = {
  dashboard: 'dashboard.read',
  overview: 'dashboard.read',
  users: 'users.read',
  kyc: 'kyc.read',
  accounts: 'accounts.read',
  wallets: 'wallet.read',
  deposits: 'finance.read',
  withdrawals: 'finance.read',
  approvals: 'finance.read',
  trading: 'trading.read',
  codes: 'trading.read',
  contracts: 'trading.read',
  markets: 'markets.manage',
  bonus: 'programs.read',
  referrals: 'programs.read',
  team: 'programs.read',
  agencies: 'agencies.manage',
  badges: 'badges.grant',
  notifications: 'notifications.manage',
  content: 'content.manage',
  configuration: 'configuration.manage',
  security: 'security.read',
  staff: 'staff.manage',
  audit: 'audit.read',
  tickets: 'tickets.read',
  'support-ai': 'support.ai.read'
};

export async function checkControlPermission(uid: string, requiredPermission?: Permission): Promise<{ allowed: boolean; roles: StaffRole[]; permissions: Permission[] }> {
  return await withTx(async (client) => {
    // 1. Fetch profile & staff status
    const pRes = await client.query('SELECT role, disabled FROM profiles WHERE id = $1', [uid]);
    if (pRes.rowCount === 0 || pRes.rows[0].disabled) {
      return { allowed: false, roles: [], permissions: [] };
    }
    const isProfileAdmin = pRes.rows[0].role === 'admin';

    const sRes = await client.query('SELECT roles, status FROM staff WHERE user_id = $1', [uid]);
    const staffRow = sRes.rows[0];

    let roles: StaffRole[] = [];
    if (staffRow && staffRow.status === 'active' && Array.isArray(staffRow.roles)) {
      roles = staffRow.roles as StaffRole[];
    } else if (isProfileAdmin) {
      roles = ['super_admin'];
    }

    if (roles.length === 0) {
      return { allowed: false, roles: [], permissions: [] };
    }

    // Expand permissions for roles (super_admin has all permissions)
    const permissions: Permission[] = roles.includes('super_admin')
      ? ALL_PERMISSIONS
      : [...new Set(roles.flatMap(r => ROLES[r]?.permissions || []))];

    if (!requiredPermission) {
      return { allowed: true, roles, permissions }; // Allowed for active staff session check
    }

    const allowed = permissions.includes(requiredPermission);
    return { allowed, roles, permissions };
  });
}

export function controlRbacMiddleware(requiredPerm?: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة. / Admin permission required.', code: 'permission_denied' });
    }

    let needed = requiredPerm;
    const urlPath = req.originalUrl.split('?')[0];

    // Evaluate required permission if request is POST /api/control/action
    if (!needed && urlPath === '/api/control/action' && req.method === 'POST') {
      const actionName = String(req.body?.action || '');
      needed = (ACTION_PERMISSIONS as Record<string, Permission>)[actionName];
    }

    // Evaluate required permission if request is GET /api/control/:module or /api/admin/:module
    if (!needed && (urlPath.startsWith('/api/control/') || urlPath.startsWith('/api/admin/'))) {
      const subPath = urlPath.replace('/api/control/', '').replace('/api/admin/', '');
      const moduleName = subPath.split('/')[0];
      if (moduleName === 'kyc-detail' || moduleName === 'kyc-document' || moduleName === 'kyc') {
        needed = (subPath.includes('files/') || subPath === 'kyc-detail' || subPath === 'kyc-document') ? 'kyc.documents' : 'kyc.read';
      } else if (moduleName && moduleName !== 'session' && MODULE_PERMISSIONS[moduleName]) {
        needed = MODULE_PERMISSIONS[moduleName];
      }
    }

    // DEFAULT DENY: If route/action has no mapped permission and is NOT session check, reject with 403!
    if (!needed && urlPath !== '/api/control/session') {
      return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة لهذا القسم. / Permission denied for this administrative module.', code: 'permission_denied' });
    }

    const check = await checkControlPermission(req.user.id, needed);
    if (!check.allowed) {
      return res.status(403).json({ error: 'صلاحية الإدارة مطلوبة لهذا القسم. / Permission denied for this administrative module.', code: 'permission_denied' });
    }

    (req as any).staffSession = check;
    next();
  };
}

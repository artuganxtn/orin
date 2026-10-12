/** The same explicit matrix drives the UI and is enforced independently by the server. */
export const PERMISSIONS = {
    'support.ai.read': 'عرض تشغيل الدعم الذكي', 'support.ai.configure': 'إعداد وتشغيل الدعم الذكي', 'support.knowledge.manage': 'تحرير معرفة الدعم', 'support.knowledge.publish': 'مراجعة ونشر معرفة الدعم',
    'dashboard.read': 'لوحة المعلومات', 'users.read': 'عرض المستخدمين والبحث', 'users.manage': 'تقييد وإعادة تفعيل المستخدمين',
    'kyc.read': 'عرض طلبات الهوية', 'kyc.documents': 'عرض وثائق الهوية الخاصة', 'kyc.review': 'مراجعة الهوية',
    'accounts.read': 'عرض الحسابات', 'accounts.manage': 'إنشاء وتعليق الحسابات', 'wallet.read': 'عرض الأرصدة المفصّلة',
    'finance.read': 'عرض العمليات المالية', 'finance.propose': 'اقتراح تسوية مالية', 'finance.approve': 'الموافقة المالية الثانية',
    'trading.read': 'عرض نشاط التداول', 'contracts.manage': 'إنشاء وإيقاف أكواد العقود الداخلية', 'markets.manage': 'إعدادات الأسواق والتداول',
    'programs.read': 'عرض البرامج والمكافآت', 'programs.configure': 'إصدار شروط البرامج',
    'referrals.review': 'مراجعة الإحالات', 'agencies.manage': 'اعتماد وإيقاف الوكلاء', 'badges.grant': 'منح الشارات الموثق',
    'notifications.manage': 'تحرير وجدولة الإشعارات', 'content.manage': 'تحرير ومعاينة المحتوى', 'content.publish': 'نشر المحتوى',
    'configuration.manage': 'إعدادات التشغيل والصيانة', 'security.read': 'قراءة الأحداث الأمنية', 'security.revoke': 'إبطال جلسات المستخدم',
    'staff.manage': 'إدارة الموظفين والأدوار', 'audit.read': 'قراءة سجل التدقيق', 'reports.export': 'تصدير البيانات المسموح بها', 'tickets.read': 'عرض تذاكر الدعم', 'tickets.manage': 'إنشاء ومتابعة التذاكر والملاحظات', 'tickets.assign': 'إسناد التذاكر إلى الموظفين'
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ROLES = {
    super_admin: { name: 'Super Admin', permissions: Object.keys(PERMISSIONS) as Permission[] },
    finance: { name: 'Finance', permissions: ['dashboard.read', 'users.read', 'accounts.read', 'wallet.read', 'finance.read', 'finance.propose', 'programs.read', 'reports.export'] as Permission[] },
    finance_approver: { name: 'Finance Approver', permissions: ['dashboard.read', 'users.read', 'accounts.read', 'wallet.read', 'finance.read', 'finance.approve', 'programs.read', 'audit.read', 'reports.export'] as Permission[] },
    kyc_reviewer: { name: 'KYC Reviewer', permissions: ['dashboard.read', 'users.read', 'kyc.read', 'kyc.documents', 'kyc.review'] as Permission[] },
    support: { name: 'Support', permissions: ['support.ai.read', 'dashboard.read', 'users.read', 'accounts.read', 'tickets.read', 'tickets.manage'] as Permission[] },
    operations: { name: 'Operations', permissions: ['support.ai.read', 'tickets.read', 'tickets.manage', 'tickets.assign', 'dashboard.read', 'users.read', 'users.manage', 'accounts.read', 'accounts.manage', 'trading.read', 'contracts.manage', 'markets.manage', 'programs.read', 'referrals.review', 'agencies.manage', 'badges.grant', 'notifications.manage', 'reports.export'] as Permission[] },
    content_manager: { name: 'Content Manager', permissions: ['support.ai.read', 'support.knowledge.manage', 'support.knowledge.publish', 'dashboard.read', 'content.manage', 'content.publish', 'notifications.manage'] as Permission[] },
    auditor: { name: 'Auditor', permissions: ['support.ai.read', 'tickets.read', 'dashboard.read', 'users.read', 'accounts.read', 'wallet.read', 'finance.read', 'trading.read', 'programs.read', 'audit.read', 'security.read', 'reports.export'] as Permission[] }
} as const;
export type StaffRole = keyof typeof ROLES;
export function permissionsFor(roles: unknown): Permission[] {
    if (!Array.isArray(roles) || roles.some(r => typeof r !== 'string' || !Object.hasOwn(ROLES, r)))
        return [];
    return [...new Set(roles.flatMap(r => ROLES[r as StaffRole].permissions))];
}
export const CONTROL_MODULES = [
    ['dashboard', 'نظرة عامة', 'Dashboard', 'dashboard.read'], ['users', 'المستخدمون', 'Users', 'users.read'], ['kyc', 'التحقق من الهوية', 'KYC', 'kyc.read'],
    ['accounts', 'الحسابات', 'Accounts', 'accounts.read'], ['wallets', 'الأرصدة', 'Wallets', 'wallet.read'], ['deposits', 'الإيداعات', 'Deposits', 'finance.read'], ['withdrawals', 'السحوبات', 'Withdrawals', 'finance.read'], ['approvals', 'الموافقات المالية', 'Approvals', 'finance.read'],
    ['trading', 'التداول', 'Trading', 'trading.read'], ['markets', 'الأسواق والأصول', 'Markets & assets', 'markets.manage'], ['bonus', 'البونص الترحيبي', 'Welcome bonus', 'programs.read'], ['referrals', 'الإحالات', 'Referrals', 'programs.read'], ['team', 'مستويات الفريق', 'Team levels', 'programs.read'], ['agencies', 'الوكلاء', 'Agencies', 'programs.read'], ['badges', 'الشارات', 'Badges', 'programs.read'], ['notifications', 'الإشعارات', 'Notifications', 'notifications.manage'], ['content', 'المحتوى', 'Content', 'content.manage'], ['configuration', 'إعدادات التطبيق', 'Configuration', 'configuration.manage'], ['security', 'الأمان', 'Security', 'security.read'], ['staff', 'الموظفون والصلاحيات', 'Staff & roles', 'staff.manage'], ['audit', 'سجل التدقيق', 'Audit log', 'audit.read'], ['tickets', 'مركز الدعم', 'Support desk', 'tickets.read'], ['codes', 'أكواد العقود', 'Contract codes', 'trading.read'], ['support-ai', 'الدعم الذكي', 'AI Support', 'support.ai.read']
] as const;
export type ControlModule = typeof CONTROL_MODULES[number][0];
export type ControlRow = Record<string, any>;
export type ControlSession = {
    available: boolean;
    uid?: string;
    roles: StaffRole[];
    permissions: Permission[];
    reason?: string;
    reauthSeconds: number;
    capabilities: Record<string, boolean>;
};
export const unavailableControl: ControlSession = { available: false, roles: [], permissions: [], reason: 'trusted_backend_required', reauthSeconds: 300, capabilities: { payments: false, execution: false, kycDocuments: false, push: false, scheduler: false } };
export const CONTROL_DEFAULTS = { maintenance: false, messageAr: 'صيانة مؤقتة، يرجى المحاولة لاحقًا.', messageEn: 'Scheduled maintenance. Please try again later.', minimumVersionCode: 1, supportEmail: '', supportUrl: '', tradingEnabled: false, depositsEnabled: false, withdrawalsEnabled: false, referralsEnabled: false, bonusEnabled: false, maxAdjustmentCents: null as number | null };
export const ACTION_PERMISSIONS = { 'contract.create': 'contracts.manage', 'contract.publish': 'contracts.manage', 'contract.revoke': 'contracts.manage', 'ticket.create': 'tickets.manage', 'ticket.update': 'tickets.manage', 'ticket.note': 'tickets.manage', 'user.status': 'users.manage', 'kyc.review': 'kyc.review', 'account.create': 'accounts.manage', 'account.status': 'accounts.manage', 'account.delete': 'accounts.manage', 'account.balance': 'finance.propose', 'account.adjust': 'finance.propose', 'reward.propose': 'finance.propose', 'reward.approve': 'finance.approve', 'reward.reject': 'finance.approve', 'finance.propose': 'finance.propose', 'finance.approve': 'finance.approve', 'finance.reject': 'finance.approve', 'payment.review': 'finance.propose', 'deposit.resolve': 'finance.propose', 'referral.review': 'referrals.review', 'agency.set': 'agencies.manage', 'badge.grant': 'badges.grant', 'content.save': 'content.manage', 'content.publish': 'content.publish', 'notification.save': 'notifications.manage', 'notification.publish': 'notifications.manage', 'market.save': 'markets.manage', 'configuration.save': 'configuration.manage', 'program.configure': 'programs.configure', 'staff.set': 'staff.manage', 'staff.invite': 'staff.manage', 'security.revoke': 'security.revoke', 'customer.verify': 'finance.propose', 'customer.revoke': 'finance.propose', 'period.close': 'finance.propose', 'bonus.expire': 'finance.propose', 'withdrawal.propose': 'finance.propose', 'withdrawal.approve': 'finance.approve', 'withdrawal.pay': 'finance.approve' } as const satisfies Record<string, Permission>;

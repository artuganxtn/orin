/** Isolated review data only. This module is never imported by the application build. */
import { ACTION_PERMISSIONS, CONTROL_MODULES, type ControlSession } from '../../lib/control-center';
import { ACTIVE_TICKET_STATUSES, TICKET_TRANSITIONS, ticketOverdue } from '../../lib/control-workflow';
import { DEFAULT_PROGRAM_CONFIG } from '../../lib/programs';
export function createReviewTransport(session: ControlSession, rows: Record<string, any[]>) {
    const used = new Map<string, any>();
    const can = (p: any) => session.permissions.includes(p);
    return async (url: string, init: RequestInit = {}) => {
        const p = new URL(url, 'https://review.invalid'), q = p.searchParams, module = p.pathname.split('/').at(-1)!;
        const denied = () => Response.json({ error: 'هذا الإجراء خارج صلاحيات دور المعاينة.' }, { status: 403 });
        if (module === 'session') return Response.json(session);
        if (init.method === 'POST') {
            const input = JSON.parse(String(init.body ?? '{}'));
            if (!can(ACTION_PERMISSIONS[input.action as keyof typeof ACTION_PERMISSIONS])) return denied();
            if (used.has(input.requestId)) return Response.json(used.get(input.requestId));
            if (!input.action?.startsWith('ticket.')) return Response.json({ saved: false, preview: true });
            const now = Date.now(), payload = input.data, ticket = rows.tickets.find(r => r.id === input.target);
            if ((ticket?.revision ?? 0) !== input.revision) return Response.json({ error: 'تغيّرت التذكرة. أعد فتحها قبل الحفظ.' }, { status: 409 });
            if (input.action === 'ticket.create') {
                if (ticket || !rows.users.some(r => r.id === payload.uid)) return Response.json({ error: 'اختر معرّف مستخدم من بيانات المعاينة.' }, { status: 400 });
                rows.tickets.unshift({ ...payload, id: input.target, status: 'open', assigneeId: '', revision: 1, noteCount: 0, createdAt: now, updatedAt: now, createdBy: session.uid, updatedBy: session.uid, notes: [] });
            } else {
                if (!ticket) return Response.json({ error: 'التذكرة غير متاحة.' }, { status: 404 });
                if (input.action === 'ticket.note') {
                    ticket.notes ??= [];
                    ticket.notes.unshift({ id: input.requestId, body: payload.body, authorId: session.uid, createdAt: now });
                    ticket.noteCount = ticket.notes.length;
                } else {
                    if (!can('tickets.assign') && ticket.assigneeId && ticket.assigneeId !== session.uid) return denied();
                    if (!can('tickets.assign') && payload.assigneeId !== ticket.assigneeId && payload.assigneeId !== '' && payload.assigneeId !== session.uid) return denied();
                    if (payload.assigneeId && !rows.staff.some(r => r.id === payload.assigneeId && r.status === 'active' && r.roles.some((role: string) => ['super_admin', 'support', 'operations'].includes(role)))) return Response.json({ error: 'اختر موظف دعم نشطًا من بيانات المعاينة.' }, { status: 400 });
                    if (ticket.status !== payload.status && !TICKET_TRANSITIONS[ticket.status]?.includes(payload.status)) return Response.json({ error: 'انتقال الحالة غير متاح.' }, { status: 409 });
                    Object.assign(ticket, payload);
                }
                ticket.revision++; ticket.updatedAt = now; ticket.updatedBy = session.uid;
            }
            rows.audit.unshift({ id: input.requestId, action: input.action, adminId: session.uid, target: input.target, timestamp: now, reason: input.reason, previous: null, next: { preview: true }, requestId: input.requestId });
            const result = { saved: true, preview: true }; used.set(input.requestId, result);
            return Response.json(result);
        }
        if (module === 'user') {
            if (!can('users.read')) return denied();
            const uid = q.get('uid'), user = rows.users.find(r => r.id === uid);
            if (!user) return Response.json({ error: 'المستخدم غير متاح.' }, { status: 404 });
            return Response.json({ user, ...(can('accounts.read') ? { accounts: rows.accounts.filter(a => a.ownerId === uid).map(a => can('wallet.read') ? a : { id: a.id, accountNumber: a.accountNumber, type: a.type, currency: a.currency }) } : {}) });
        }
        const entry = CONTROL_MODULES.find(m => m[0] === module);
        if (!entry || !can(entry[3]) || q.get('export') === 'true' && !can('reports.export')) return denied();
        if (module === 'dashboard') {
            const active = rows.tickets.filter(t => ACTIVE_TICKET_STATUSES.includes(t.status));
            return Response.json({ asOf: Date.now(), stats: [['users', 'users.read'], ['kyc', 'kyc.read'], ['deposits', 'finance.read'], ['withdrawals', 'finance.read']].filter(([, permission]) => can(permission)).map(([id]) => ({ id, count: rows[id].length })), activity: can('audit.read') ? rows.audit.slice(0, 8) : [], queues: [
                ...(can('tickets.read') ? [{ id: 'tickets', module: 'tickets', label: 'تذاكر دعم مفتوحة', count: active.length }, { id: 'tickets_mine', module: 'tickets', label: 'تذاكري المفتوحة', assignee: 'mine', count: active.filter(t => t.assigneeId === session.uid).length }, { id: 'tickets_overdue', module: 'tickets', label: 'تذاكر متأخرة عن الموعد', count: active.filter(t => ticketOverdue(t)).length }] : []),
                ...(can('finance.read') ? [{ id: 'approvals', module: 'approvals', label: 'موافقات مالية معلّقة', count: rows.approvals.filter(r => r.status === 'pending').length }] : []),
                ...(can('kyc.read') ? [{ id: 'kyc', module: 'kyc', label: 'طلبات هوية تنتظر المراجعة', count: rows.kyc.filter(r => ['pending', 'review', 'more_information'].includes(r.status)).length }] : [])
            ] });
        }
        let result = [...(rows[module] ?? [])];
        if (module === 'tickets' && q.get('ticket')) {
            const ticket = result.find(r => r.id === q.get('ticket'));
            if (!ticket) return Response.json({ error: 'التذكرة غير متاحة.' }, { status: 404 });
            const { notes, ...data } = ticket;
            return Response.json({ ticket: data, notes: notes ?? [], nextNotesCursor: null });
        }
        if (module === 'tickets') {
            if (q.get('priority') && q.get('priority') !== 'all') result = result.filter(t => t.priority === q.get('priority'));
            if (q.get('assignee') === 'mine') result = result.filter(t => t.assigneeId === session.uid);
            if (q.get('assignee') === 'unassigned') result = result.filter(t => !t.assigneeId);
            result = result.map(({ notes, description, ...t }) => t).sort((a, b) => b.updatedAt - a.updatedAt);
        }
        if (module === 'accounts' && !can('wallet.read')) result = result.map(({ balanceCents, cashCents, bonusCents, profitCents, withdrawableProfitCents, ...a }) => a);
        const status = q.get('status');
        if (status && status !== 'all') result = result.filter(r => module === 'tickets' && status === 'active' ? ACTIVE_TICKET_STATUSES.includes(r.status) : r.status === status);
        if (module === 'users' && q.get('search')) result = result.filter(r => [r.id, r.email, r.displayName, ...rows.accounts.filter(a => a.ownerId === r.id).map(a => a.accountNumber)].includes(q.get('search')));
        if (module === 'audit') {
            for (const k of ['adminId', 'action', 'target']) if (q.get(k)) result = result.filter(r => r[k] === q.get(k));
            if (q.get('from')) result = result.filter(r => r.timestamp >= Number(q.get('from')));
            if (q.get('to')) result = result.filter(r => r.timestamp <= Number(q.get('to')));
            result.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
        }
        const offset = Number(q.get('cursor') || 0);
        return Response.json({ rows: result.slice(offset, offset + 50), nextCursor: result.length > offset + 50 ? String(offset + 50) : null, configuration: DEFAULT_PROGRAM_CONFIG, asOf: Date.now() });
    };
}

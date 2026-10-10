export const TICKET_STATUSES = {
    open: 'مفتوحة', in_progress: 'قيد المعالجة', waiting: 'بانتظار معلومات', resolved: 'تم الحل', closed: 'مغلقة'
} as const;
export const TICKET_PRIORITIES = { low: 'منخفضة', normal: 'عادية', high: 'عالية', urgent: 'عاجلة' } as const;
export const TICKET_CATEGORIES = { account: 'الحساب', technical: 'مشكلة تقنية', identity: 'التحقق من الهوية', payment: 'استفسار مالي', other: 'أخرى' } as const;
export const TICKET_TRANSITIONS: Record<string, readonly string[]> = {
    open: ['in_progress', 'waiting', 'resolved'],
    in_progress: ['open', 'waiting', 'resolved'],
    waiting: ['open', 'in_progress', 'resolved'],
    resolved: ['open', 'closed'], closed: ['open']
};
export const ACTIVE_TICKET_STATUSES = ['open', 'in_progress', 'waiting'];
export const ticketOverdue = (ticket: { status: string; dueAt?: number | null }, now = Date.now()) =>
    ACTIVE_TICKET_STATUSES.includes(ticket.status) && typeof ticket.dueAt === 'number' && ticket.dueAt < now;

/** Local-calendar boundaries, including days with a daylight-saving transition. */
export function auditDateBoundary(day: string, end = false): string {
    if (!day) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return '';
    const y = Number(match[1]), m = Number(match[2]) - 1, d = Number(match[3]);
    const start = new Date(y, m, d);
    if (start.getFullYear() !== y || start.getMonth() !== m || start.getDate() !== d) return '';
    return String(end ? new Date(y, m, d + 1).getTime() - 1 : start.getTime());
}

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { db, ROLES, controlRead, controlAction } from '../firebase-functions/control-test.mjs';

const staff = Object.fromEntries(Object.keys(ROLES).map(role => [role, { id: 'ops-' + role, name: role, email: role + '@ops.example.test', verified: true, authTime: Math.floor(Date.now() / 1000) }]));
const customer = { id: 'ops-customer', email: 'customer@ops.example.test', name: 'Customer', verified: true, authTime: Math.floor(Date.now() / 1000) };
const call = (actor, action, target, data, revision = 0, requestId = crypto.randomUUID()) => controlAction(actor, { action, target, data, revision, requestId, reason: 'Isolated workflow verification' });
const create = (target, data = {}) => call(staff.support, 'ticket.create', target, { uid: customer.id, title: 'Login assistance', description: 'An internal support request', priority: 'normal', category: 'technical', dueAt: null, ...data });
const update = (actor, id, revision, data = {}) => call(actor, 'ticket.update', id, { status: 'open', priority: 'normal', assigneeId: '', dueAt: null, ...data }, revision);
before(async () => {
    assert.equal(process.env.GCLOUD_PROJECT, 'demo-orin-auth');
    assert(process.env.FIRESTORE_EMULATOR_HOST);
    for (const u of [...Object.values(staff), customer]) await db.doc('users/' + u.id).set({ uid: u.id, email: u.email, displayName: u.name, disabled: false });
    for (const [role, u] of Object.entries(staff)) await db.doc('orinStaff/' + u.id).set({ email: u.email, roles: [role], status: 'active', revision: 0 });
});
test('tickets enforce read/write permissions for customers, finance and auditor', async () => {
    await create('ops-permissions');
    for (const actor of [customer, staff.finance, staff.content_manager]) {
        await assert.rejects(controlRead(actor, 'tickets'), e => e.status === 403);
        await assert.rejects(call(actor, 'ticket.note', 'ops-permissions', { body: 'Not allowed' }, 1), e => e.status === 403);
    }
    assert((await controlRead(staff.auditor, 'tickets')).rows.some(r => r.id === 'ops-permissions'));
    await assert.rejects(call(staff.auditor, 'ticket.note', 'ops-permissions', { body: 'Not allowed' }, 1), e => e.status === 403);
    await assert.rejects(controlRead(staff.support, 'tickets', { export: 'true' }), e => e.status === 403);
});
test('ticket creation validates customer, content, fields and due date; caller cannot set status or owner', async () => {
    await assert.rejects(create('ops-invalid-user', { uid: 'missing-user' }), e => e.status === 404);
    for (const data of [{ priority: 'financial' }, { category: 'unknown' }, { title: 'x'.repeat(161) }, { description: '' }, { dueAt: -1 }, { balanceCents: 999 }, { status: 'closed' }, { assigneeId: staff.super_admin.id }]) await assert.rejects(create('ops-invalid', data));
    assert.equal((await db.doc('orinControlTickets/ops-invalid').get()).exists, false);
});
test('assignment allows self-claim and supervisor routing; denies stealing and disabled/ineligible assignees', async () => {
    await create('ops-assignment');
    await assert.rejects(update(staff.support, 'ops-assignment', 1, { assigneeId: staff.operations.id }), e => e.status === 403);
    await update(staff.support, 'ops-assignment', 1, { assigneeId: staff.support.id });
    await update(staff.operations, 'ops-assignment', 2, { assigneeId: staff.operations.id });
    await assert.rejects(update(staff.support, 'ops-assignment', 3, { assigneeId: staff.support.id }), e => e.status === 403);
    await assert.rejects(update(staff.operations, 'ops-assignment', 3, { assigneeId: staff.finance.id }), e => e.status === 409);
    await db.doc('orinStaff/' + staff.support.id).update({ status: 'disabled' });
    await assert.rejects(update(staff.operations, 'ops-assignment', 3, { assigneeId: staff.support.id }), e => e.status === 409);
    await db.doc('orinStaff/' + staff.support.id).update({ status: 'active' });
});
test('workflow requires resolution before closure, supports reopen and rejects stale updates', async () => {
    await create('ops-lifecycle');
    await assert.rejects(update(staff.support, 'ops-lifecycle', 1, { status: 'closed' }), /transition/);
    await update(staff.support, 'ops-lifecycle', 1, { status: 'in_progress' });
    await assert.rejects(update(staff.support, 'ops-lifecycle', 1, { status: 'resolved' }), e => e.status === 409);
    await update(staff.support, 'ops-lifecycle', 2, { status: 'resolved' });
    await update(staff.support, 'ops-lifecycle', 3, { status: 'closed' });
    const closedAt = (await db.doc('orinControlTickets/ops-lifecycle').get()).data().closedAt;
    assert(closedAt);
    await update(staff.support, 'ops-lifecycle', 4, { status: 'closed', priority: 'low' });
    assert.equal((await db.doc('orinControlTickets/ops-lifecycle').get()).data().closedAt, closedAt);
    await update(staff.support, 'ops-lifecycle', 5, { status: 'open' });
    const r = (await db.doc('orinControlTickets/ops-lifecycle').get()).data();
    assert.equal(r.resolvedAt, null); assert.equal(r.closedAt, null);
});
test('concurrent duplicate note retries create one immutable note and one audit event', async () => {
    await create('ops-notes');
    const requestId = crypto.randomUUID(), body = '<script>private text</script>';
    await Promise.all([call(staff.support, 'ticket.note', 'ops-notes', { body }, 1, requestId), call(staff.support, 'ticket.note', 'ops-notes', { body }, 1, requestId)]);
    const result = await controlRead(staff.support, 'tickets', { ticket: 'ops-notes' });
    assert.equal(result.ticket.noteCount, 1); assert.equal(result.notes.length, 1); assert.equal(result.notes[0].body, body);
    assert.equal((await db.collection('orinControlAudit').where('requestId', '==', requestId).get()).size, 1);
    const audit = (await db.collection('orinControlAudit').where('requestId', '==', requestId).get()).docs[0].data();
    assert(!JSON.stringify(audit).includes(body));
    await assert.rejects(call(staff.support, 'ticket.note', 'ops-notes', { body: 'changed' }, 2, requestId), e => e.status === 409);
    await assert.rejects(call(staff.support, 'ticket.delete', 'ops-notes', {}, 2));
});
test('ticket filters and pagination cover all matches with timestamp ties without leaking cursor scope', async () => {
    const batch = db.batch(), now = Date.now();
    for (let i = 0; i < 53; i++) batch.set(db.doc('orinControlTickets/ops-page-' + String(i).padStart(3, '0')), { uid: customer.id, title: 'Ticket ' + i, status: 'open', priority: 'urgent', category: 'account', assigneeId: staff.support.id, updatedAt: now, createdAt: now, revision: 1, dueAt: null, noteCount: 0, privateExtra: 'not projected' });
    await batch.commit();
    const q = { status: 'active', priority: 'urgent', assignee: 'mine' }, first = await controlRead(staff.support, 'tickets', q), second = await controlRead(staff.support, 'tickets', { ...q, cursor: first.nextCursor });
    assert.equal(first.rows.length, 50); assert.equal(second.rows.length, 3);
    assert.equal(new Set([...first.rows, ...second.rows].map(r => r.id)).size, 53);
    assert(!('privateExtra' in first.rows[0]));
    await assert.rejects(controlRead(staff.support, 'tickets', { ...q, priority: 'low', cursor: first.nextCursor }), /cursor/);
    await assert.rejects(controlRead(staff.support, 'tickets', { cursor: '../../users' }), /cursor/);
});
test('note pagination returns old notes and rejects a cursor from another ticket', async () => {
    const batch = db.batch(), now = Date.now();
    for (let i = 0; i < 52; i++) batch.set(db.doc('orinControlTickets/ops-permissions/notes/page-' + String(i).padStart(3, '0')), { body: 'Note ' + i, authorId: staff.support.id, createdAt: now });
    await batch.commit();
    const first = await controlRead(staff.support, 'tickets', { ticket: 'ops-permissions' });
    const second = await controlRead(staff.support, 'tickets', { ticket: 'ops-permissions', notesCursor: first.nextNotesCursor });
    assert.equal(first.notes.length, 50); assert.equal(second.notes.length, 2);
    assert.equal(new Set([...first.notes, ...second.notes].map(r => r.id)).size, 52);
    await assert.rejects(controlRead(staff.support, 'tickets', { ticket: 'ops-notes', notesCursor: first.nextNotesCursor }), /cursor/);
});
test('audit combines actor, action, target and inclusive date boundaries across pages', async () => {
    const base = Date.now() - 600000, batch = db.batch();
    for (let i = 0; i < 54; i++) batch.set(db.doc('orinControlAudit/ops-audit-' + String(i).padStart(3, '0')), { adminId: staff.support.id, action: 'ticket.note', target: 'ops-audit-target', timestamp: base + (i < 53 ? 0 : 1), reason: 'Pagination fixture' });
    await batch.commit();
    const filters = { adminId: staff.support.id, action: 'ticket.note', target: 'ops-audit-target', from: String(base), to: String(base) };
    const first = await controlRead(staff.auditor, 'audit', filters), second = await controlRead(staff.auditor, 'audit', { ...filters, cursor: first.nextCursor });
    assert.equal(first.rows.length, 50); assert.equal(second.rows.length, 3); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.rows, ...second.rows].map(r => r.id)).size, 53);
    await assert.rejects(controlRead(staff.auditor, 'audit', { ...filters, target: 'other', cursor: first.nextCursor }), /cursor/);
    await assert.rejects(controlRead(staff.auditor, 'audit', { from: '2', to: '1' }), /date/);
    await assert.rejects(controlRead(staff.auditor, 'audit', { from: 'NaN' }), /date/);
    await assert.rejects(controlRead(staff.support, 'audit', filters), e => e.status === 403);
});
test('audit export preserves filters and produces a separately audited export record', async () => {
    const result = await controlRead(staff.auditor, 'audit', { action: 'ticket.note', target: 'ops-audit-target', export: 'true' });
    assert.equal(result.rows.length, 50); assert(result.rows.every(r => r.target === 'ops-audit-target'));
    const exports = await db.collection('orinControlAudit').where('adminId', '==', staff.auditor.id).where('action', '==', 'report.export').get();
    assert(exports.docs.some(d => d.data().next.filters.target === 'ops-audit-target'));
    await assert.rejects(controlRead({ ...staff.auditor, authTime: 1 }, 'audit', { export: 'true' }), e => e.status === 401);
});
test('work queues are permission-scoped and count overdue tickets only while open', async () => {
    await create('ops-overdue', { dueAt: Date.now() - 1000 });
    const first = await controlRead(staff.support, 'dashboard');
    assert(first.queues.every(q => q.module === 'tickets'));
    const overdue = first.queues.find(q => q.id === 'tickets_overdue').count;
    assert(overdue >= 1);
    await update(staff.support, 'ops-overdue', 1, { status: 'resolved', dueAt: Date.now() - 1000 });
    const second = await controlRead(staff.support, 'dashboard');
    assert.equal(second.queues.find(q => q.id === 'tickets_overdue').count, overdue - 1);
    assert((await controlRead(staff.finance, 'dashboard')).queues.every(q => q.module !== 'tickets'));
});

import {SupportAIAdmin} from './support-ai-admin';
import {SupportDesk} from './support-desk';
'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Users, ShieldCheck, Wallet, ArrowDownLeft, ArrowUpRight, CheckCheck, ChartCandlestick, Coins, Gift, Network, Award, Bell, FileText, Settings, Lock, History, Search, RefreshCw, Download, ChevronLeft, X, Plus, Menu, ExternalLink, Shield, Building2, SlidersHorizontal, Headphones, MessageSquare, Clock, Bot } from 'lucide-react';
import { apiFetch } from '../lib/client-api';
import { CONTROL_MODULES, ROLES, PERMISSIONS, CONTROL_DEFAULTS, type ControlSession, type ControlRow, type Permission } from '../lib/control-center';
import { DEFAULT_PROGRAM_CONFIG, BADGES } from '../lib/programs';
import {ASSETS} from '../lib/contracts';
import { MARKET_SYMBOLS } from '../lib/market-symbols';
import { TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES, TICKET_TRANSITIONS, ticketOverdue, auditDateBoundary } from '../lib/control-workflow';
import './control-center.css';
type Props = {
    path?: string;
    navigate?: (path: string) => void;
    request?: typeof apiFetch;
    reauthenticate?: () => Promise<void>;
    preview?: boolean;
    initialSession?: ControlSession;
    initialData?: any;
};
type Field = {
    key: string;
    label: string;
    type?: string;
    options?: [
        string,
        string
    ][];
    required?: boolean;
    value?: any;
};
type Edit = {
    title: string;
    action: string;
    target: string;
    revision: number;
    fields: Field[];
    data?: any;
    preview?: boolean;
};
const icons = [LayoutDashboard, Users, ShieldCheck, Wallet, Coins, ArrowDownLeft, ArrowUpRight, CheckCheck, ChartCandlestick, SlidersHorizontal, Gift, Network, Network, Building2, Award, Bell, FileText, Settings, Lock, Shield, History, Headphones, ChartCandlestick, Bot];
const labels: Record<string, string> = { fullName: 'الاسم بالوثيقة', documentType: 'نوع الوثيقة', idNumber: 'رقم الوثيقة', country: 'الدولة', documentImage: 'صورة الوثيقة', userEmail: 'بريد المستخدم', provider:'بوابة الدفع', coin:'عملة الدفع', credited:'أضيف إلى الرصيد', reviewReason:'سبب المراجعة', paymentId:'رقم الدفع لدى المزوّد', code:'كود العقد', mode:'نوع التنفيذ', asset:'الأصل', direction:'الاتجاه', duration_sec:'المدة بالثواني', settlement_bps:'نسبة التسوية (100 = 1%)', opens_at:'بدء المشاركة', closes_at:'انتهاء المشاركة', closesAt:'انتهاء المشاركة', opensAt:'بدء المشاركة', published_at:'تاريخ الإنشاء', hash:'بصمة الشروط', admin_id:'المسؤول المنشئ', description: 'وصف الطلب', priority: 'الأولوية', assigneeId: 'الموظف المسؤول', dueAt: 'موعد المتابعة', resolvedAt: 'وقت الحل', closedAt: 'وقت الإغلاق', createdBy: 'أنشأها', updatedBy: 'آخر تحديث بواسطة', noteCount: 'الملاحظات الداخلية', authorId: 'الموظف', body: 'الملاحظة', id: 'المعرّف', uid: 'المستخدم', ownerId: 'المستخدم', displayName: 'الاسم', email: 'البريد', status: 'الحالة', accountNumber: 'رقم الحساب', type: 'النوع', currency: 'العملة', balanceCents: 'الرصيد', cashCents: 'الأموال النقدية', bonusCents: 'أصل البونص', profitCents: 'أرباح البونص', withdrawableCents: 'أرباح قابلة للسحب', withdrawableProfitCents: 'أرباح قابلة للسحب', withdrawableCashCents: 'نقد قابل للسحب', lockedProfitCents: 'أرباح مقفلة', amountCents: 'القيمة', cents: 'القيمة', deltaCents: 'قيمة التسوية', beforeCents: 'الرصيد السابق', afterCents: 'الرصيد اللاحق', reference: 'المرجع', providerReference: 'مرجع المزوّد', reason: 'السبب', requestedBy: 'مقدم الطلب', approvedBy: 'الموافق', reviewedBy: 'المراجع', accountId: 'معرّف الحساب', referrerId: 'الداعي', referredId: 'الصديق', referralId: 'رقم الإحالة', agencyId: 'رقم الوكالة', agencyGranted: 'معتمدة', directCount: 'المباشرون', activeTeamCount: 'الفريق النشط', teamCount: 'الفريق', activityRewardCents: 'مكافأة النشاط', badges: 'الشارات', roles: 'الأدوار', createdAt: 'تاريخ الإنشاء', updatedAt: 'آخر تحديث', timestamp: 'الوقت', adminId: 'المسؤول', action: 'العملية', target: 'الهدف', requestId: 'رقم الطلب', referenceId: 'المرجع', previous: 'قبل العملية', next: 'بعد العملية', revision: 'الإصدار', termsVersion: 'إصدار الشروط', documentIds: 'الوثائق', title: 'العنوان', message: 'النص', titleAr: 'العنوان العربي', titleEn: 'العنوان الإنجليزي', bodyAr: 'النص العربي', bodyEn: 'النص الإنجليزي', audience: 'الجمهور', segment: 'الشريحة', startsAt: 'بدء الإرسال', expiresAt: 'انتهاء الصلاحية', delivered: 'التسليم داخل التطبيق', pair: 'الرمز', name: 'الاسم', category: 'السوق', enabled: 'مفعّل', order: 'الترتيب', source: 'المصدر', level: 'المستوى', direct: 'مباشرون', active: 'الفريق النشط', bps: 'مكافأة النشاط', capCents: 'حد الصرف', event: 'الحدث', kind: 'نوع العملية', user_id: 'المستخدم', amount_cents: 'قيمة الصفقة', result_cents: 'النتيجة', contract_id: 'مرجع الصفقة', slug: 'الصفحة', withdrawalEligibility: 'أهلية السحب' };
const statuses: Record<string, string> = { ...TICKET_STATUSES, ...TICKET_PRIORITIES, ...TICKET_CATEGORIES, pending: 'قيد الانتظار', waiting:'بانتظار الدفع', creating:'جار إنشاء الطلب', confirming:'بانتظار تأكيد الشبكة', confirmed:'مؤكد على الشبكة', sending:'قيد التحويل', finished:'مكتمل', partially_paid:'دفع جزئي', failed:'فشل', refunded:'مسترد', expired:'منتهي', review: 'قيد المراجعة', verified: 'موثّق', rejected: 'مرفوض', more_information: 'معلومات إضافية', active: 'نشط', restricted: 'مقيّد', suspended: 'موقوف', disabled: 'معطّل', completed: 'مكتمل', processing: 'قيد المعالجة', cancelled: 'ملغى', revoked:'موقوف', 'virtual-test-only':'عقد داخلي برصيد افتراضي', qualified: 'مؤهل', approved: 'معتمد', paid: 'مدفوع', draft: 'مسودة', published: 'منشور', queued: 'بانتظار الإرسال', scheduled: 'مجدول', delivering: 'جارٍ الإرسال', real: 'حساب حقيقي', demo: 'حساب تجريبي', all: 'الجميع', user: 'مستخدم', segment: 'شريحة', provider_required: 'يحتاج تأكيد مزوّد السحب', adjustment: 'تسوية', payment: 'عملية دفع' };
const columns: Record<string, string[]> = { codes:['code','title','asset','direction','status','closesAt'], tickets: ['title', 'uid', 'priority', 'status', 'assigneeId', 'dueAt'], users: ['displayName', 'email', 'id', 'status'], kyc: ['fullName', 'documentType', 'idNumber', 'country', 'status', 'createdAt', 'reviewedBy'], accounts: ['accountNumber', 'email', 'type', 'balanceCents', 'status'], wallets: ['accountNumber', 'cashCents', 'bonusCents', 'profitCents', 'withdrawableCents'], deposits: ['uid', 'cents', 'currency', 'status', 'providerReference'], withdrawals: ['uid', 'cents', 'currency', 'status', 'providerReference'], approvals: ['kind', 'uid', 'deltaCents', 'status', 'requestedBy'], trading: ['user_id', 'contract_id', 'amount_cents', 'status'], markets: ['pair', 'category', 'enabled', 'source'], bonus: ['uid', 'bonusCents', 'profitCents', 'withdrawableCents', 'termsVersion'], referrals: ['referrerId', 'referredId', 'amountCents', 'status'], team: ['id', 'direct', 'active', 'bps', 'capCents'], agencies: ['uid', 'agencyId', 'agencyGranted', 'directCount'], badges: ['uid', 'badges'], notifications: ['title', 'audience', 'status', 'delivered'], content: ['titleAr', 'slug', 'status', 'revision'], security: ['uid', 'event', 'status', 'createdAt'], staff: ['email', 'roles', 'status'], audit: ['action', 'target', 'adminId', 'timestamp'] };
export const controlCsv = (rows: ControlRow[], keys: string[]) => [keys.map(k => labels[k] ?? k), ...rows.map(r => keys.map(k => r[k] ?? ''))].map(r => r.map(v => '"' + String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/^[\s]*[=+@\-]/, m => "'" + m).replaceAll('"', '""') + '"').join(',')).join('\r\n');
const date = (v: number) => new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
function value(k: string, v: any): React.ReactNode {
    if (v === null || v === undefined)
        return '—';
    if (typeof v === 'boolean')
        return v ? 'نعم' : 'لا';
    if (k === 'documentImage' || (typeof v === 'string' && v.startsWith('data:image/')))
        return <img src={v} alt="وثيقة الهوية" style={{maxWidth:'100%', maxHeight:'260px', borderRadius:'10px', display:'block', marginTop:'6px', border:'1px solid rgba(255,255,255,0.18)'}}/>;
    if (k === 'documentType')
        return ({ id_card: 'بطاقة هوية وطنية', passport: 'جواز سفر', driver_license: 'رخصة قيادة' } as any)[v] ?? v;
    if (k === 'bps')
        return <bdi>{Number(v) / 100}%</bdi>;
    if (/Cents$|_cents$/.test(k) || k === 'cents')
        return <bdi>{(Number(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD</bdi>;
    if (/At$|_at$/.test(k) || k === 'timestamp' || k === 'closesAt' || k === 'opensAt') {
        const t = typeof v === 'number' ? v : !isNaN(Number(v)) ? Number(v) : Date.parse(String(v));
        return !isNaN(t) ? <bdi>{date(t)}</bdi> : String(v || '—');
    }
    if (Array.isArray(v))
        return v.map(x => typeof x === 'string' ? (ROLES[x as keyof typeof ROLES]?.name ?? BADGES.find(b => b.id === x)?.ar ?? x) : JSON.stringify(x)).join(' · ');
    if (typeof v === 'object')
        return <dl className="occ-nested">{Object.entries(v).map(([key, v]) => <React.Fragment key={key}><dt>{labels[key] ?? key}</dt><dd>{value(key, v)}</dd></React.Fragment>)}</dl>;
    if (k === 'status' || k === 'type')
        return <span className={'occ-status occ-status-' + v}>{statuses[v] ?? v}</span>;
    return <bdi>{statuses[v] ?? String(v)}</bdi>;
}
function trapFocus(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Tab')
        return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')).filter(el => el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first)
        return;
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
    }
    else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}
const field = (key: string, label: string, type = 'text', options?: [
    string,
    string
][]): Field => ({ key, label, type, options, required: true });
const fallbackSession: ControlSession = {
    available: false,
    roles: [],
    permissions: [],
    reason: 'session_expired',
    reauthSeconds: 0,
    capabilities: { payments: false, execution: false, kycDocuments: false, push: false, scheduler: false }
};
export function ControlCenter({ path = '/admin', navigate, request = apiFetch, reauthenticate, preview = false, initialSession, initialData }: Props) {
    const [module, setModule] = useState(path.split('/')[2] || 'dashboard'), [session, setSession] = useState<ControlSession>(initialSession ?? fallbackSession), [data, setData] = useState<any>(initialData ?? null), [loading, setLoading] = useState(!initialData), [error, setError] = useState(''), [message, setMessage] = useState(''), [search, setSearch] = useState(''), [globalSearch, setGlobalSearch] = useState(''), [status, setStatus] = useState('all'), [cursor, setCursor] = useState(''), [row, setRow] = useState<ControlRow | null>(null), [detail, setDetail] = useState<any>(null), [edit, setEdit] = useState<Edit | null>(null), [busy, setBusy] = useState(false), [mobile, setMobile] = useState(false), [reauth, setReauth] = useState(false);
    const [priority, setPriority] = useState('all'), [assignee, setAssignee] = useState('all'), [pageHistory, setPageHistory] = useState<string[]>([]), [detailLoading, setDetailLoading] = useState(false);
    const [kycPromptRow, setKycPromptRow] = useState<ControlRow | null>(null), [kycReasonInput, setKycReasonInput] = useState('');
    const blankAudit = { from: '', to: '', adminId: '', action: '', target: '' };
    const [auditDraft, setAuditDraft] = useState(blankAudit), [auditFilters, setAuditFilters] = useState(blankAudit);
    const detailSequence = useRef(0);
    const sequence = useRef(0), command = useRef(''), locked = useRef(false), formRef = useRef<HTMLFormElement>(null);
    const can = (p: Permission) => session?.permissions.includes(p) ?? true;
    const read = useCallback(async (p: string, options?: RequestInit) => {
        const headers = new Headers(options?.headers);
        if (options?.body)
            headers.set('Content-Type', 'application/json');
        const r = await request(p, { ...options, headers });
        const body: any = await r.json();
        if (!r.ok) {
            if (r.status === 401)
                setReauth(true);
            throw new Error(body.error ?? 'تعذّر إتمام الطلب. أعد المحاولة.');
        }
        return body;
    }, [request]);
    useEffect(() => { setModule(path.split('/')[2] || 'dashboard'); }, [path]);
    useEffect(() => {
        let active = true;
        void read('/api/control/session').then(s => {
            if (active && s?.available) {
                setSession(s);
            }
        }).catch(() => {
            if (active) {
                setSession(fallbackSession);
            }
        });
        return () => { active = false; };
    }, [read]);
    const load = useCallback(async () => {
        const n = ++sequence.current;
        if (!session?.available)
            return;
        setLoading(true);
        setError('');
        try {
            const q = new URLSearchParams({ status, ...(cursor ? { cursor } : {}), ...(module === 'users' && search ? { search } : {}), ...(module === 'tickets' ? { priority, assignee } : {}), ...(module === 'audit' ? { ...auditFilters, from: auditDateBoundary(auditFilters.from), to: auditDateBoundary(auditFilters.to, true) } : {}) });
            const result = await read('/api/control/' + module + '?' + q);
            if (n === sequence.current)
                setData(result);
        }
        catch (e) {
            if (n === sequence.current) {
                setData(null);
                setError((e as Error).message);
            }
        }
        finally {
            if (n === sequence.current)
                setLoading(false);
        }
    }, [module, status, cursor, session, read, search, priority, assignee, auditFilters]);
    useEffect(() => { void load(); return () => { sequence.current++; }; }, [load, initialData]);
    useEffect(() => {
        if (!session?.available || preview || module === 'support-ai')
            return;
        const timer = setInterval(() => {
            if (!document.hidden && !edit && !row && navigator.onLine)
                void load();
        }, 60000);
        return () => clearInterval(timer);
    }, [session, preview, edit, row, load, module]);
    useEffect(() => {
        if (!row && !edit)
            return;
        const previous = document.activeElement as HTMLElement | null;
        formRef.current?.querySelector<HTMLInputElement>('input,textarea,select')?.focus();
        const close = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !locked.current) {
                setEdit(null);
                setRow(null);
            }
        };
        addEventListener('keydown', close);
        return () => { removeEventListener('keydown', close); previous?.focus(); };
    }, [row, edit]);
    const go = (m: string) => { detailSequence.current++; setModule(m); setSearch(''); setPriority('all'); setAssignee('all'); setAuditDraft(blankAudit); setAuditFilters(blankAudit); setPageHistory([]); setStatus('all'); setCursor(''); setRow(null); setDetail(null); setData(null); setMobile(false); navigate?.('/admin' + (m === 'dashboard' ? '' : '/' + m)); };
    const begin = (e: Edit) => { command.current = crypto.randomUUID(); setError(''); setEdit(e); };
    const generic = (title: string, action: string, fields: Field[], data?: any, target = row?.id ?? crypto.randomUUID()) => begin({ title, action, fields, data: data ?? row ?? {}, target, revision: row?.revision ?? 0 });
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!edit || locked.current)
            return;
        const fd = new FormData(e.currentTarget), payload: any = { ...edit.data };
        for (const f of edit.fields) {
            const raw = fd.get(f.key);
            payload[f.key] = f.type === 'checkbox' ? raw === 'on' : f.type === 'number' ? Number(raw) : f.type === 'money' ? Math.round(Number(raw) * 100) : f.type === 'datetime-local' ? (raw ? new Date(String(raw)).getTime() : null) : f.type === 'roles' ? [String(raw)] : f.type === 'csv' ? String(raw).split(',').map(x => x.trim()).filter(Boolean) : f.type === 'nullable-number' ? (raw ? Number(raw) : null) : String(raw ?? '');
        }
        const target = edit.action === 'market.save' ? payload.pair : typeof payload._target === 'string' ? payload._target.trim() : edit.target;
        delete payload._target;
        if (edit.action === 'program.configure') {
            payload.levels = edit.data.levels.map((l: any, i: number) => ({ ...l, ...Object.fromEntries(['direct', 'active', 'bps', 'capCents'].map(k => [k, Number(payload['level_' + i + '_' + k])])) }));
            for (const k of Object.keys(payload))
                if (k.startsWith('level_'))
                    delete payload[k];
            for (const k of ['referralCriteria', 'activeTeamCriteria', 'activityPeriod', 'bonusTradingTerms', 'agencyCriteria', 'termsVersion'])
                if (!payload[k])
                    payload[k] = null;
            if (!payload.eligibleAssets?.length)
                payload.eligibleAssets = null;
        }
        locked.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await read('/api/control/action', { method: 'POST', body: JSON.stringify({ action: edit.action, target, revision: edit.revision, requestId: command.current, reason: fd.get('reason'), data: payload }) });
            setEdit(null);
            setRow(null);
            setMessage(preview ? 'معاينة فقط — لم تُرسل أي عملية إلى ORIN.' : result.status === 'pending' ? 'تم تقديم الطلب بنجاح — بانتظار موافقة المسؤول الثاني (الموافقات المالية).' : result.code ? `تم إنشاء الكود ${result.code} وتسجيل شروطه.` : 'تم تنفيذ العملية بنجاح وتحديث البيانات في سجل التدقيق.');
            await load();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            locked.current = false;
            setBusy(false);
        }
    }
    async function exportPage() {
        setBusy(true);
        try {
            const q = new URLSearchParams({ export: 'true', status, ...(cursor ? { cursor } : {}), ...(module === 'users' && search ? { search } : {}), ...(module === 'tickets' ? { priority, assignee } : {}), ...(module === 'audit' ? { ...auditFilters, from: auditDateBoundary(auditFilters.from), to: auditDateBoundary(auditFilters.to, true) } : {}) });
            const d = await read('/api/control/' + module + '?' + q), rows = d.rows ?? [], keys = [...new Set(rows.flatMap((r: any) => Object.keys(r)))] as string[];
            const url = URL.createObjectURL(new Blob(['\ufeff' + controlCsv(rows, keys)], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ORIN-' + module + '-' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage('تم تصدير الصفحة الحالية فقط، ضمن صلاحياتك.');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function inspect(r: ControlRow) {
        if (module === 'kyc') {
            setKycPromptRow(r);
            setKycReasonInput('');
            return;
        }
        const token = ++detailSequence.current;
        setRow(r); setDetail(null); setDetailLoading(true);
        try {
            if (module === 'users' || module === 'tickets') {
                const result = await read(module === 'users' ? '/api/control/user?uid=' + encodeURIComponent(r.id) : '/api/control/tickets?ticket=' + encodeURIComponent(r.id));
                if (token === detailSequence.current) { setDetail(result); if (result.ticket) setRow(result.ticket); }
            }
        } catch (e) { if (token === detailSequence.current) setError((e as Error).message); }
        finally { if (token === detailSequence.current) setDetailLoading(false); }
    }
    async function submitKycReason(reason: string) {
        if (!kycPromptRow || reason.trim().length < 5) return;
        const targetRow = kycPromptRow;
        setKycPromptRow(null);
        const token = ++detailSequence.current;
        setRow(targetRow); setDetail(null); setDetailLoading(true);
        try {
            const result = await read('/api/control/kyc-detail?id=' + encodeURIComponent(targetRow.id) + '&reason=' + encodeURIComponent(reason.trim()));
            if (token === detailSequence.current) { setDetail(result); setRow(prev => ({ ...prev, ...result })); }
        } catch (e) { if (token === detailSequence.current) setError((e as Error).message); }
        finally { if (token === detailSequence.current) setDetailLoading(false); }
    }
    async function moreNotes() {
        if (!row || !detail?.nextNotesCursor) return;
        const token = detailSequence.current; setDetailLoading(true);
        try {
            const next = await read('/api/control/tickets?' + new URLSearchParams({ ticket: row.id, notesCursor: detail.nextNotesCursor }));
            if (token === detailSequence.current) setDetail((current: any) => ({ ...current, notes: [...current.notes, ...next.notes], nextNotesCursor: next.nextNotesCursor }));
        } catch (e) { if (token === detailSequence.current) setError((e as Error).message); }
        finally { if (token === detailSequence.current) setDetailLoading(false); }
    }
    function ticketEditor(r?: ControlRow, uid = '') {
        const optional = (f: Field) => ({ ...f, required: false });
        begin({ title: r ? 'متابعة تذكرة الدعم' : 'تذكرة دعم جديدة', action: r ? 'ticket.update' : 'ticket.create', target: r?.id ?? crypto.randomUUID(), revision: r?.revision ?? 0,
            data: r ? { status: r.status, priority: r.priority, assigneeId: r.assigneeId, dueAt: r.dueAt } : { uid, title: '', description: '', category: 'account', priority: 'normal', dueAt: null },
            fields: [ ...(!r ? [field('uid', 'معرّف المستخدم'), field('title', 'عنوان الطلب'), field('description', 'وصف الطلب', 'textarea'), field('category', 'نوع الطلب', 'select', Object.entries(TICKET_CATEGORIES))] : [field('status', 'حالة الطلب', 'select', [r.status, ...(TICKET_TRANSITIONS[r.status] ?? [])].map(s => [s, TICKET_STATUSES[s as keyof typeof TICKET_STATUSES]])), ...(can('tickets.assign') ? [optional(field('assigneeId', 'معرّف الموظف المسؤول — فارغ لإلغاء الإسناد'))] : [])]),
                field('priority', 'الأولوية', 'select', Object.entries(TICKET_PRIORITIES)), optional(field('dueAt', 'موعد المتابعة (بتوقيت جهازك)', 'datetime-local')) ] });
    }
    async function documentDownload(id: string) {
        if (!row)
            return;
        setBusy(true);
        try {
            const r = await request('/api/control/kyc-document?id=' + encodeURIComponent(row.id) + '&documentId=' + encodeURIComponent(id));
            if (!r.ok)
                throw new Error((await r.json() as any).error);
            const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
            a.href = url;
            a.download = id;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    const selection = (key: string, label: string, values: string[]) => field(key, label, 'select', values.map(v => [v, statuses[v] ?? v]));
    const actions = () => {
        if (!row)
            return null;
        return <div className="occ-actions">
  {module === 'codes' && <><button onClick={()=>void navigator.clipboard.writeText(row.code).then(()=>setMessage('تم نسخ الكود')).catch(()=>setError('تعذر النسخ؛ يمكنك تحديد الكود ونسخه.'))}>نسخ الكود</button>{can('contracts.manage')&&row.status==='active'&&<button onClick={()=>generic('إيقاف المشاركة الجديدة — تبقى الشروط والمشاركات السابقة محفوظة','contract.revoke',[],{})}>إيقاف الكود</button>}</>}
  {module === 'users' && can('tickets.manage') && <button onClick={() => ticketEditor(undefined, row.id)}><Headphones size={15}/>فتح تذكرة دعم</button>}
  {module === 'tickets' && can('tickets.manage') && <>
    {(can('tickets.assign') || !row.assigneeId || row.assigneeId === session?.uid) && <button disabled={detailLoading} onClick={() => ticketEditor(row)}>تحديث الحالة والأولوية</button>}
    {!row.assigneeId && <button onClick={() => generic('استلام التذكرة', 'ticket.update', [], { status: row.status, priority: row.priority, assigneeId: session?.uid, dueAt: row.dueAt })}>إسناد إليّ</button>}
    {row.assigneeId === session?.uid && <button onClick={() => generic('إلغاء إسناد التذكرة إليّ', 'ticket.update', [], { status: row.status, priority: row.priority, assigneeId: '', dueAt: row.dueAt })}>إلغاء إسنادي</button>}
    <button onClick={() => generic('إضافة ملاحظة داخلية محفوظة', 'ticket.note', [field('body', 'الملاحظة — للفريق فقط', 'textarea')], {})}><MessageSquare size={15}/>ملاحظة داخلية</button>
  </>}
  {module === 'users' && can('users.manage') && <button onClick={() => generic('تغيير حالة المستخدم', 'user.status', [selection('status', 'الحالة', ['active', 'restricted', 'suspended'])], { status: row.status })}>إدارة الحالة</button>}
  {module === 'users' && can('accounts.manage') && <button onClick={() => generic('إنشاء حساب للمستخدم', 'account.create', [selection('type', 'نوع الحساب', ['real', 'demo']), field('balance', 'الرصيد الافتتاحي بالدولار ($)', 'number')], { target: row.id, balance: '0' })}>إنشاء حساب للمستخدم</button>}
  {module === 'users' && <button style={{color:'#ef4444',borderColor:'#fca5a5'}} onClick={() => generic('تعطيل أو إيقاف هذا المستخدم', 'user.status', [], { status: 'suspended' })}>إيقاف المستخدم</button>}
  {module === 'accounts' && <button className="occ-primary" onClick={() => generic('تعديل رصيد الحساب مباشرة', 'account.balance', [field('balance', 'الرصيد الجديد بالدولار ($ USD)', 'number')], { uid: row.ownerId, accountId: row.id, balance: ((Number(row.balanceCents || row.cashCents || 0)) / 100).toFixed(2) })}>تعديل الرصيد ($)</button>}
  {module === 'accounts' && can('accounts.manage') && <button onClick={() => generic('إدارة حالة الحساب', 'account.status', [selection('status', 'الحالة', ['active', 'restricted'])], { uid: row.ownerId, status: row.status })}>إدارة الحالة</button>}
  {module === 'accounts' && <button style={{color:'#ef4444',borderColor:'#fca5a5'}} onClick={() => generic('حذف / إغلاق حساب التداول نهائيًا', 'account.delete', [], { uid: row.ownerId, accountId: row.id })}>حذف الحساب</button>}
  {module === 'kyc' && can('kyc.review') && row.status !== 'verified' && <button onClick={() => generic('مراجعة طلب الهوية', 'kyc.review', [selection('status', 'القرار', row.status === 'review' ? ['verified', 'rejected', 'more_information'] : ['review'])], {})}>مراجعة الطلب</button>}
  {module === 'kyc' && can('kyc.documents') && (row.documentIds ?? []).map((id: string) => <button key={id} disabled={busy || !session?.capabilities.kycDocuments} onClick={() => void documentDownload(id)}>وثيقة {id} <Lock size={14}/></button>)}
  {module === 'wallets' && can('finance.propose') && row.type === 'real' && <button onClick={() => generic('اقتراح تسوية — تحتاج موافقة شخص آخر', 'finance.propose', [field('deltaCents', 'قيمة التغيير بالدولار (+ / −)', 'money'), field('reference', 'مرجع العملية الفريد')], { uid: row.uid, accountId: row.accountId })}>اقتراح تسوية</button>}
  {['deposits', 'withdrawals'].includes(module) && can('finance.propose') && row.provider !== 'nowpayments' && row.status === 'pending' && <button onClick={() => generic('طلب مراجعة مالية ثانية', 'payment.review', [selection('decision', 'القرار', ['approve', 'reject', 'cancel'])], { module })}>مراجعة العملية</button>}
  {module === 'approvals' && can('finance.approve') && row.status === 'pending' && row.requestedBy !== session?.uid && <><button onClick={() => generic('اعتماد الطلب المالي', 'finance.approve', [], {})}>موافقة ثانية</button><button onClick={() => generic('رفض الطلب المالي', 'finance.reject', [], {})}>رفض</button></>}
  {module === 'referrals' && can('referrals.review') && !['paid', 'rejected'].includes(row.status) && <button onClick={() => generic('مراجعة الإحالة', 'referral.review', [selection('status', 'القرار', row.status === 'pending' ? ['qualified', 'rejected'] : row.status === 'qualified' ? ['approved', 'rejected'] : ['rejected']), { ...field('evidenceId', 'مرجع دليل الأهلية الموثوق'), required: false }], {})}>مراجعة الأهلية</button>}
  {module === 'referrals' && row.status === 'approved' && can('finance.propose') && <button onClick={() => generic('طلب صرف مكافأة إحالة — موافقة ثانية مطلوبة', 'reward.propose', [field('accountId', 'معرّف حساب الداعي الحقيقي'), field('reference', 'مرجع مالي فريد')], { rewardKind: 'referral', rewardId: row.id })}>طلب صرف المكافأة</button>}
  {module === 'agencies' && can('finance.propose') && <button onClick={() => generic('طلب مكافأة نشاط من الإيرادات المؤهلة', 'reward.propose', [field('rewardId', 'معرّف سجل الإيرادات المعتمد'), field('accountId', 'معرّف الحساب الحقيقي'), field('reference', 'مرجع مالي فريد')], { rewardKind: 'team' })}>طلب مكافأة نشاط</button>}
  {module === 'agencies' && can('agencies.manage') && <button onClick={() => generic('اعتماد أو إيقاف الوكيل', 'agency.set', [field('granted', 'وكيل معتمد', 'checkbox')], { granted: row.agencyGranted })}>إدارة الوكالة</button>}
  {module === 'badges' && can('badges.grant') && <button onClick={() => generic('منح شارة موثّق', 'badge.grant', [field('badge', 'الشارة', 'select', BADGES.filter(b => !['verified', 'trader', 'first_deposit'].includes(b.id)).map(b => [b.id, b.ar])), field('evidenceReference', 'مرجع التحقق من الإنجاز')], {})}>منح شارة</button>}
  {module === 'markets' && can('markets.manage') && <button onClick={() => marketEditor(row)}>تعديل التوفر</button>}
  {module === 'staff' && can('staff.manage') && row.id !== session?.uid && <button onClick={() => staffEditor(row)}>إدارة الموظف</button>}
  {(module === 'users' || module === 'staff') && can('security.revoke') && row.id !== session?.uid && <button onClick={() => generic('إبطال جلسات الحساب', 'security.revoke', [], {})}>إبطال الجلسات</button>}
  {['content', 'notifications'].includes(module) && <><button onClick={() => contentEditor(row)}>تحرير مسودة</button>{row.status === 'draft' && can(module === 'content' ? 'content.publish' : 'notifications.manage') && <button onClick={() => begin({ title: 'معاينة وتأكيد ' + (module === 'content' ? 'النشر' : 'الإرسال'), action: module === 'content' ? 'content.publish' : 'notification.publish', target: row.id, revision: row.revision, fields: [], data: { previewRevision: row.revision }, preview: true })}>معاينة قبل النشر</button>}</>}
 </div>;
    };
    function contractEditor() { begin({title:'إنشاء كود عقد داخلي — رصيد افتراضي',action:'contract.create',target:crypto.randomUUID(),revision:0,data:{mode:'virtual-test-only',asset:Object.keys(ASSETS)[0],direction:'BUY',durationSec:60,settlementBps:0,eligibility:'all',opensAt:Date.now()+60000,closesAt:Date.now()+86400000},fields:[field('title','عنوان العقد'),field('asset','الأصل','select',Object.entries(ASSETS).map(([k,v])=>[k,v])),field('direction','الاتجاه','select',[['BUY','شراء'],['SELL','بيع']]),field('durationSec','المدة: 60 إلى 300 ثانية','number'),field('settlementBps','تسوية افتراضية محددة مسبقًا: 100 = 1%','number'),field('eligibility','الأهلية','select',[['all','الجميع'],['standard','قياسي'],['advanced','متقدم']]),field('opensAt','فتح المشاركة','datetime-local'),field('closesAt','إغلاق المشاركة','datetime-local')]}); }
    function marketEditor(r?: ControlRow) { begin({ title: 'إعداد الأصل — المصدر ثابت ومعتمد', action: 'market.save', target: r?.id ?? 'market-' + crypto.randomUUID(), revision: r?.revision ?? 0, data: r ? { pair: r.pair, enabled: r.enabled, order: r.order } : { pair: MARKET_SYMBOLS[0].pair, enabled: true, order: 0 }, fields: [field('pair', 'الأصل', 'select', MARKET_SYMBOLS.map(s => [s.pair, s.pair + ' · ' + s.name])), field('enabled', 'متاح في الأسواق', 'checkbox'), field('order', 'ترتيب العرض', 'number')] }); }
    function staffEditor(r?: ControlRow) { begin({ title: r ? 'صلاحيات الموظف' : 'إسناد دور إلى مستخدم مسجّل', action: 'staff.set', target: r?.id ?? '', revision: r?.revision ?? 0, data: { roles: r?.roles ?? ['support'], status: r?.status ?? 'active' }, fields: [...(!r ? [field('_target', 'User ID')] : []), field('roles', 'الدور', 'roles', Object.entries(ROLES).map(([k, r]) => [k, r.name])), selection('status', 'الحالة', ['active', 'disabled'])] }); }
    function contentEditor(r?: ControlRow) { const notification = module === 'notifications'; begin({ title: notification ? 'مسودة إشعار' : 'مسودة محتوى', action: notification ? 'notification.save' : 'content.save', target: r?.id ?? crypto.randomUUID(), revision: r?.revision ?? 0, data: notification ? { title: r?.title ?? '', message: r?.message ?? '', audience: r?.audience ?? 'all', targetUid: r?.targetUid ?? '', segment: r?.segment ?? 'all', startsAt: r?.startsAt ?? Date.now(), expiresAt: r?.expiresAt ?? Date.now() + 86400000 } : { titleAr: r?.titleAr ?? '', titleEn: r?.titleEn ?? '', bodyAr: r?.bodyAr ?? '', bodyEn: r?.bodyEn ?? '' }, fields: notification ? [field('title', 'العنوان'), field('message', 'نص الإشعار', 'textarea'), selection('audience', 'الجمهور', ['all', 'user', 'segment']), { ...field('targetUid', 'User ID — عند اختيار مستخدم'), required: false }, selection('segment', 'الشريحة', ['all', 'real', 'demo', 'agents', 'verified']), field('startsAt', 'بدء الإرسال', 'datetime-local'), field('expiresAt', 'انتهاء الإرسال', 'datetime-local')] : [...(!r ? [field('_target', 'اسم الصفحة بالإنجليزية (terms / privacy / help / faq / banner)')] : []), field('titleAr', 'العنوان العربي'), field('titleEn', 'العنوان الإنجليزي'), field('bodyAr', 'النص العربي', 'textarea'), field('bodyEn', 'النص الإنجليزي', 'textarea')] }); }
    function configEditor() { const c = data?.rows?.[0] ?? { ...CONTROL_DEFAULTS, revision: 0 }; begin({ title: 'إعدادات التشغيل — تُحفظ بإصدار جديد', action: 'configuration.save', target: 'current', revision: c.revision ?? 0, data: Object.fromEntries(Object.keys(CONTROL_DEFAULTS).map(k => [k, c[k] ?? (CONTROL_DEFAULTS as any)[k]])), fields: [field('maintenance', 'وضع الصيانة', 'checkbox'), field('messageAr', 'رسالة الصيانة العربية'), field('messageEn', 'رسالة الصيانة الإنجليزية'), field('minimumVersionCode', 'أدنى إصدار Android مسموح', 'number'), { ...field('supportEmail', 'بريد الدعم', 'email'), required: false }, { ...field('supportUrl', 'رابط الدعم HTTPS', 'url'), required: false }, { ...field('maxAdjustmentCents', 'أقصى تسوية مالية بالسنت — فارغ لتعطيلها', 'nullable-number'), required: false }, ...(['tradingEnabled', 'depositsEnabled', 'withdrawalsEnabled', 'referralsEnabled', 'bonusEnabled'] as const).map((k, i) => field(k, ['التداول', 'الإيداع', 'السحب', 'الإحالات', 'البونص'][i], 'checkbox'))] }); }
    function programEditor() { const c = data?.configuration ?? DEFAULT_PROGRAM_CONFIG; begin({ title: 'إصدار جديد لشروط البرامج — لا يغيّر المنح السابقة', action: 'program.configure', target: 'current', revision: c.revision, data: { ...c, levels: c.levels.map((l: any) => ({ ...l })) }, fields: [field('enabled', 'البرنامج مفعّل', 'checkbox'), field('termsVersion', 'معرّف إصدار جديد للشروط'), field('bonusAmountCents', 'البونص USD', 'money'), field('referralAmountCents', 'مكافأة الإحالة USD', 'money'), field('firstDepositCents', 'أول إيداع مؤهل USD', 'money'), { ...field('bonusDurationDays', 'مدة البونص بالأيام', 'nullable-number'), required: false }, { ...field('bonusProfitLimitCents', 'حد أرباح البونص بالسنت', 'nullable-number'), required: false }, { ...field('eligibleAssets', 'الأصول المؤهلة — مفصولة بفاصلة', 'csv'), required: false }, ...['referralCriteria', 'activeTeamCriteria', 'activityPeriod', 'bonusTradingTerms', 'agencyCriteria'].map((k, i) => ({ ...field(k, ['شروط أهلية الإحالة', 'شروط نشاط الفريق', 'فترة حساب النشاط', 'شروط تداول البونص', 'شروط الوكالة'][i], 'textarea'), required: false })), ...c.levels.flatMap((l: any, i: number) => ['direct', 'active', 'bps', 'capCents'].map(k => ({ ...field('level_' + i + '_' + k, 'L' + l.level + ' · ' + (labels[k] ?? k) + (k === 'bps' ? ' (100 = 1%)' : k === 'capCents' ? ' (سنت)' : ''), 'number'), value: l[k] })))] }); }
    const title = CONTROL_MODULES.find(x => x[0] === module);
    const rows = (data?.rows ?? []) as ControlRow[];
    const visible = module === 'users' || !search ? rows : rows.filter(r => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));
    if (!session?.available) {
        return (
            <div className="occ-error-screen" style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--orin-surface)', borderRadius: '16px', margin: '20px', border: '1px solid var(--orin-line)' }}>
                <h2>{error || 'جلسة الإدارة غير متصلة أو منتهية الصلاحية'}</h2>
                <p style={{ color: 'var(--orin-muted)', margin: '12px 0 20px' }}>يرجى إعادة تسجيل الدخول بحساب مسؤول مخول المزاولة.</p>
                <button className="occ-primary" onClick={() => void reauthenticate?.()}>إعادة المصادقة</button>
            </div>
        );
    }
    return <div className="occ" dir="rtl">
  <aside className={'occ-sidebar' + (mobile ? ' is-open' : '')}><a className="occ-brand" href="/admin" onClick={e => { e.preventDefault(); go('dashboard'); }}><img src="/brand/orin-mark.png" alt=""/><span>ORIN<small>CONTROL CENTER</small></span></a><span className="occ-nav-label">مساحة الإدارة</span><nav aria-label="أقسام الإدارة">{CONTROL_MODULES.map(([m, ar, en, p], i) => { const Icon = icons[i]; return can(p) ? <button key={m} className={module === m ? 'active' : ''} onClick={() => go(m)} aria-current={module === m ? 'page' : undefined}><Icon size={18}/><span>{ar}</span>{module === m && <i />}</button> : null; })}</nav><div className="occ-sidebar-foot"><ShieldCheck size={19}/><div><span>{(session?.roles ?? []).map(r => ROLES[r]?.name ?? r).join(' · ')}<small>جلسة محمية · صلاحيات كاملة</small></span><button style={{background:'transparent',border:'none',color:'#f87171',cursor:'pointer',fontSize:'12px',padding:'4px 0',display:'block'}} onClick={()=>void reauthenticate?.()}>تسجيل الخروج</button></div></div></aside>
  <div className="occ-workspace"><header className="occ-topbar"><button className="occ-menu" aria-label="القائمة" onClick={() => setMobile(!mobile)}><Menu /></button><div className="occ-breadcrumb">مركز التحكم <ChevronLeft size={14}/><strong>{title?.[1] ?? 'القسم'}</strong></div>{can('users.read') && <form className="occ-global-search" onSubmit={e => { e.preventDefault(); go('users'); setSearch(globalSearch.trim()); }}><Search size={15}/><input aria-label="البحث العام عن المستخدم" placeholder="بحث باسم، بريد أو رقم حساب" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}/></form>}<button className="occ-app-link" style={{cursor:'pointer',background:'transparent',border:'none',color:'inherit'}} onClick={()=>void reauthenticate?.()}>تسجيل الخروج</button><div className="occ-avatar"><Shield size={18}/></div></header>
  <main className="occ-main">{module==='tickets'&&!preview&&can('tickets.manage')&&<SupportDesk/>}{preview && <div className="occ-preview-banner">معاينة تفاعلية ببيانات توضيحية — لا اتصال بحسابات أو أموال حقيقية.</div>}
   <div className="occ-quick-nav">
    {CONTROL_MODULES.map(([m, ar, en, p], i) => {
      const Icon = icons[i];
      if (!can(p)) return null;
      const active = module === m;
      return (
        <button
          key={m}
          className={'occ-nav-pill' + (active ? ' active' : '')}
          onClick={() => go(m)}
        >
          <Icon size={14}/>
          <span>{ar}</span>
        </button>
      );
    })}
   </div>
   <div className="occ-page-heading"><div><span className="occ-eyebrow">ORIN / {title?.[2]?.toUpperCase()}</span><h1>{title?.[1] ?? 'صفحة غير متاحة'}</h1><p>{module === 'dashboard' ? 'صورة واضحة للنظام، وقرارات ضمن الصلاحيات.' : 'سجلات محددة الصلاحيات. كل تعديل حساس يترك أثرًا قابلًا للمراجعة.'}</p></div><button className="occ-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'occ-spin' : ''}/>تحديث</button></div>
   {error && <div className="occ-error" role="alert">{error}{reauth && reauthenticate && <button onClick={() => void reauthenticate()}>إعادة المصادقة</button>}</div>}{message && <div className="occ-message" role="status">{message}<button aria-label="إغلاق الرسالة" onClick={() => setMessage('')}><X size={14}/></button></div>}
   {loading ? <div className="occ-empty" role="status"><RefreshCw className="occ-spin"/><h2>جارٍ تحميل السجلات</h2><p>يتم التحقق من الصلاحيات على الخادم.</p></div> : module === 'dashboard' ? <>
    <section className="occ-overview"><div><span className="occ-eyebrow">OPERATIONS OVERVIEW</span><h2>إدارة دقيقة.<br />رؤية متكاملة.</h2><p>آخر تحديث <bdi>{data?.asOf ? date(data.asOf) : '—'}</bdi> · يتحدث كل دقيقة</p></div><img src="/brand/orin-mark.png" alt=""/><span className="occ-overview-tag"><ShieldCheck size={15}/> سجل تدقيق مركزي</span></section>
    <div className="occ-stats">{(data?.stats ?? []).map((s: any) => {
      const targetModule = s.id.startsWith('accounts') ? 'accounts' : s.id;
      return (
        <article key={s.id} onClick={() => go(targetModule)} role="button" tabIndex={0} title={'فتح قسم ' + (CONTROL_MODULES.find(m => m[0] === targetModule)?.[1] ?? targetModule)}>
          <span>{CONTROL_MODULES.find(m => m[0] === s.id)?.[1] ?? ({ accounts_real: 'الحسابات الحقيقية', accounts_demo: 'الحسابات التجريبية' } as any)[s.id] ?? s.id}</span>
          <strong>{s.count === null ? 'عرض' : Number(s.count).toLocaleString('en-US')}</strong>
          <small>انقر لعرض السجلات ←</small>
        </article>
      );
    })}</div>
    {data?.queues?.length > 0 && <section className="occ-panel occ-queue-panel"><div className="occ-panel-heading"><h2>قائمة المتابعة</h2><span>WORK QUEUE</span></div><div className="occ-queue-grid">{data.queues.map((q: any) => <article key={q.id} className={q.id === 'tickets_overdue' && q.count > 0 ? 'is-overdue' : ''}><span>{q.label}</span><strong>{q.count === null ? 'غير متاح' : q.count.toLocaleString('en-US')}</strong><button onClick={() => { go(q.module); if (q.assignee) setAssignee(q.assignee); if (q.module === 'tickets') setStatus('active'); }}>فتح القسم <ChevronLeft size={14}/></button></article>)}</div></section>}
    <div className="occ-dashboard-grid"><section className="occ-panel"><div className="occ-panel-heading"><h2>آخر الأحداث</h2><span>ACTIVITY</span></div>{data?.activity?.length ? <div className="occ-activity">{data.activity.map((r: any) => <article key={r.id}><span className="occ-dot"/><div><strong>{r.action}</strong><p>{r.reason}</p><small><bdi>{r.adminId}</bdi> · {date(r.timestamp)}</small></div></article>)}</div> : <p className="occ-muted">لا توجد أحداث متاحة ضمن صلاحياتك.</p>}</section><section className="occ-panel"><div className="occ-panel-heading"><h2>حالة التكاملات</h2><span>SYSTEM</span></div>{[['payments', 'الدفع والتسويات'], ['execution', 'تنفيذ التداول'], ['kycDocuments', 'وثائق الهوية الخاصة'], ['scheduler', 'جدولة الإشعارات'], ['push', 'إشعارات Push']].map(([k, n]) => <div className="occ-capability" key={k}><span>{n}</span><span className={'occ-status ' + (session.capabilities[k] ? 'occ-status-active' : '')}>{session.capabilities[k] ? 'موصول' : 'غير مفعّل'}</span></div>)}<p className="occ-muted">الحالات من الخادم؛ لا تفعّلها أزرار الواجهة.</p></section></div>
   </> : module === 'support-ai' ? <SupportAIAdmin initialData={data} session={session} read={read} reauthenticate={reauthenticate} navigate={go}/> : <>
    <div className="occ-toolbar"><form onSubmit={e => { e.preventDefault(); setCursor(''); void load(); }} className="occ-search"><Search size={17}/><input aria-label="البحث" value={search} onChange={e => setSearch(e.target.value)} placeholder={module === 'users' ? 'اسم كامل، بريد، User ID أو رقم حساب' : module === 'accounts' ? 'رقم حساب أو معرّف مستخدم' : 'بحث في السجلات المعروضة'}/>{(module === 'users' || module === 'accounts') && <button>بحث</button>}</form>{['tickets', 'kyc', 'deposits', 'withdrawals', 'approvals', 'referrals', 'notifications', 'content', 'staff'].includes(module) && <select aria-label="تصفية الحالة" value={status} onChange={e => { setStatus(e.target.value); setCursor(''); setPageHistory([]); }}><option value="all">كل الحالات</option>{(module === 'tickets' ? ['active', ...Object.keys(TICKET_STATUSES)] : ['waiting','confirming','confirmed','sending','finished','partially_paid','failed','refunded','expired','pending', 'review', 'verified', 'more_information', 'qualified', 'approved', 'paid', 'active', 'disabled', 'draft', 'published', 'scheduled', 'processing', 'completed', 'rejected', 'cancelled']).map(s => <option key={s} value={s}>{module === 'tickets' && s === 'active' ? 'كل التذاكر المفتوحة' : statuses[s]}</option>)}</select>}{module === 'accounts' && <button className="occ-primary" onClick={() => generic('إنشاء حساب تداول جديد لمستخدم', 'account.create', [field('_target', 'معرّف المستخدم (User ID)'), selection('type', 'نوع الحساب', ['real', 'demo']), field('balance', 'الرصيد الافتتاحي بالدولار', 'number')], { balance: '0' })}><Plus size={16}/>إنشاء حساب جديد</button>}{module === 'tickets' && can('tickets.manage') && <button className="occ-primary" onClick={() => ticketEditor()}><Plus size={16}/>تذكرة جديدة</button>}{can('reports.export') && module !== 'configuration' && <button disabled={busy} onClick={() => void exportPage()}><Download size={16}/>تصدير الصفحة</button>}{['content', 'notifications'].includes(module) && <button className="occ-primary" onClick={() => contentEditor()}><Plus size={16}/>مسودة جديدة</button>}{module === 'codes' && can('contracts.manage') && <button className="occ-primary" onClick={contractEditor}><Plus size={16}/>إنشاء كود عقد</button>}{module === 'markets' && <button className="occ-primary" onClick={() => marketEditor()}>إعداد أصل</button>}{module === 'staff' && can('staff.manage') && <><button onClick={() => staffEditor()}><Plus size={16}/>إسناد دور</button><button onClick={() => generic('دعوة موظف — بعد تسجيله وتأكيد بريده', 'staff.invite', [field('email', 'البريد', 'email'), field('roles', 'الدور', 'roles', Object.entries(ROLES).filter(([k]) => k !== 'super_admin').map(([k, r]) => [k, r.name]))], {})}>دعوة موظف</button></>}{module === 'team' && can('programs.configure') && <button className="occ-primary" onClick={programEditor}>إصدار شروط جديد</button>}{module === 'configuration' && can('configuration.manage') && <button className="occ-primary" onClick={configEditor}>تعديل الإعدادات</button>}</div>
    {module === 'tickets' && <div className="occ-filter-panel"><label>الأولوية<select value={priority} onChange={e => { setPriority(e.target.value); setCursor(''); setPageHistory([]); }}><option value="all">كل الأولويات</option>{Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>الإسناد<select value={assignee} onChange={e => { setAssignee(e.target.value); setCursor(''); setPageHistory([]); }}><option value="all">كل الفريق</option><option value="mine">مسندة إليّ</option><option value="unassigned">بدون مسؤول</option></select></label><p>الملاحظات داخلية للفريق. الأوقات حسب جهازك، والتذاكر المتأخرة مميزة في الجدول.</p></div>}
    {module === 'audit' && <form className="occ-filter-panel" onSubmit={e => { e.preventDefault(); if (auditDraft.from && auditDraft.to && auditDraft.from > auditDraft.to) { setError('تاريخ البداية يجب أن يسبق تاريخ النهاية.'); return; } setAuditFilters({ ...auditDraft }); setCursor(''); setPageHistory([]); }}>
      {(['from', 'to', 'adminId', 'action', 'target'] as const).map(k => <label key={k}>{({ from: 'من تاريخ', to: 'إلى تاريخ', adminId: 'معرّف الموظف', action: 'العملية بالضبط', target: 'معرّف الهدف' })[k]}<input type={k === 'from' || k === 'to' ? 'date' : 'text'} value={auditDraft[k]} maxLength={128} onChange={e => setAuditDraft({ ...auditDraft, [k]: e.target.value })}/></label>)}<button className="occ-primary" type="submit">تطبيق الفلاتر</button><button type="button" onClick={() => { setAuditDraft(blankAudit); setAuditFilters(blankAudit); setCursor(''); setPageHistory([]); }}>مسح الفلاتر</button><p>يُبحث في السجل الكامل، والأحدث أولًا. يشمل تاريخ النهاية اليوم كاملًا حسب توقيت جهازك.</p>
    </form>}
    {module === 'deposits' && <p className="occ-note">طلبات NOWPayments الفعلية. تأكيد الإيداع وإضافة الرصيد يعتمد على إشعار المزوّد الموثّق والتحقق من المبلغ، وليس تعديل الحالة يدويًا.</p>}
    {module === 'codes' && <p className="occ-note">أكواد هذا القسم مرتبطة بمحرك العقود الداخلية الافتراضي الموجود في ORIN. لا تُنفّذ أوامر بأموال حقيقية. الشروط ثابتة بعد الإنشاء؛ إيقاف الكود يمنع المشاركة الجديدة فقط.</p>}
    {module === 'users' && <p className="occ-muted">البحث العام يطابق الاسم الكامل أو البريد أو المعرّف أو رقم الحساب بالكامل.</p>}
    {module === 'team' && <p className="occ-note">مكافأة نشاط الفريق تُحسب من صافي إيرادات ORIN المؤهلة. القيم التالية تخص إصدار الشروط الحالي؛ تبقى المنح السابقة مرتبطة بإصدارها.</p>}
    {module === 'configuration' ? <section className="occ-panel"><dl className="occ-details">{Object.entries(data?.rows?.[0] ?? {}).filter(([k]) => k !== 'id').map(([k, v]) => <React.Fragment key={k}><dt>{({ maintenance: 'وضع الصيانة', messageAr: 'رسالة الصيانة', messageEn: 'Maintenance message', minimumVersionCode: 'أدنى إصدار Android', supportEmail: 'بريد الدعم', supportUrl: 'رابط الدعم', tradingEnabled: 'التداول', depositsEnabled: 'الإيداع', withdrawalsEnabled: 'السحب', referralsEnabled: 'الإحالات', bonusEnabled: 'البونص', maxAdjustmentCents: 'حد التسوية المالية' } as any)[k] ?? labels[k] ?? k}</dt><dd>{value(k, v)}</dd></React.Fragment>)}</dl></section> : visible.length ? <section className="occ-table-panel"><div className="occ-table-scroll"><table><thead><tr>{(columns[module] ?? ['id', 'status']).map(k => <th key={k}>{labels[k] ?? k}</th>)}<th>التفاصيل</th></tr></thead><tbody>{visible.map((r, i) => <tr key={r.id + ':' + (r.ownerId ?? i)} onClick={() => void inspect(r)} style={{cursor:'pointer'}} title="اضغط لفتح الإدارة والتفاصيل">{(columns[module] ?? ['id', 'status']).map(k => <td key={k}>{k === 'assigneeId' && !r[k] ? 'بدون مسؤول' : value(k, r[k])}{module === 'tickets' && k === 'dueAt' && ticketOverdue(r as any) && <span className="occ-overdue"><Clock size={12}/>متأخرة</span>}</td>)}<td><button aria-label={'فتح تفاصيل ' + (r.accountNumber ?? r.displayName ?? r.id)} onClick={(e) => { e.stopPropagation(); void inspect(r); }}>عرض <ChevronLeft size={14}/></button></td></tr>)}</tbody></table></div><footer><span>{visible.length.toLocaleString('en-US')} سجل في هذه الصفحة</span><div>{cursor && <><button onClick={() => { setCursor(''); setPageHistory([]); }}>البداية</button><button disabled={!pageHistory.length} onClick={() => { setCursor(pageHistory.at(-1) ?? ''); setPageHistory(pageHistory.slice(0, -1)); }}>السابق</button></>}<button disabled={!data?.nextCursor} onClick={() => { setPageHistory([...pageHistory, cursor]); setCursor(data.nextCursor); }}>التالي <ChevronLeft size={14}/></button></div></footer></section> : <section className="occ-empty"><FileText size={30}/><h2>{error ? 'تعذّر تحميل السجلات' : 'لا توجد سجلات متاحة'}</h2><p>ستظهر هنا البيانات التي تصل من خدمات ORIN المربوطة، ضمن صلاحياتك.</p></section>}
    {module === 'staff' && <section className="occ-panel occ-role-matrix"><h2>الأدوار والصلاحيات</h2><div className="occ-table-scroll"><table><thead><tr><th>الصلاحية</th>{Object.values(ROLES).map(r => <th key={r.name}>{r.name}</th>)}</tr></thead><tbody>{Object.entries(PERMISSIONS).map(([p, label]) => <tr key={p}><td>{label}</td>{Object.values(ROLES).map(r => <td key={r.name}>{r.permissions.includes(p as Permission) ? '✓' : '—'}</td>)}</tr>)}</tbody></table></div></section>}
   </>}
  </main><footer className="occ-footer"><span>ORIN CONTROL CENTER</span><span>البيانات المالية والسجلات محمية من التعديل المباشر</span></footer></div>
  {row && !edit && <div className="occ-overlay"><section role="dialog" onKeyDown={trapFocus} aria-modal="true" aria-label="تفاصيل السجل" className="occ-drawer"><header><div><span className="occ-eyebrow">RECORD DETAILS</span><h2>{row.displayName ?? row.titleAr ?? row.title ?? row.accountNumber ?? 'تفاصيل السجل'}</h2></div><button autoFocus onClick={() => setRow(null)} aria-label="إغلاق التفاصيل"><X /></button></header>{error && <div role="alert" className="occ-error">{error}</div>}{actions()}<dl className="occ-details">{Object.entries(row).map(([k, v]) => <React.Fragment key={k}><dt>{labels[k] ?? k}</dt><dd>{value(k, v)}</dd></React.Fragment>)}</dl>{detailLoading && <p role="status" className="occ-muted">جارٍ تحميل التفاصيل…</p>}{module === 'tickets' && detail && <section className="occ-ticket-notes"><h3>الملاحظات الداخلية</h3>{detail.notes?.length ? detail.notes.map((note: any) => <article key={note.id}><header><bdi>{note.authorId}</bdi><time>{date(note.createdAt)}</time></header><p>{note.body}</p></article>) : <p className="occ-muted">لا توجد ملاحظات داخلية بعد.</p>}{detail.nextNotesCursor && <button disabled={detailLoading} onClick={() => void moreNotes()}>ملاحظات أقدم</button>}</section>}{module !== 'tickets' && detail && Object.entries(detail).filter(([k]) => k !== 'user').map(([k, v]) => <section className="occ-detail-section" key={k}><h3>{({ accounts: 'الحسابات المرتبطة', kyc: 'طلبات الهوية', program: 'الإحالات والوكالة والشارات', bonus: 'البونص' } as any)[k] ?? k}</h3>{Array.isArray(v) ? v.map((item, i) => <div key={i}>{value('object', item)}</div>) : value('object', v)}</section>)}</section></div>}
  {edit && <div className="occ-overlay"><section className="occ-dialog" role="dialog" onKeyDown={trapFocus} aria-modal="true" aria-labelledby="occ-edit-title"><header><h2 id="occ-edit-title">{edit.title}</h2><button aria-label="إغلاق" disabled={busy} onClick={() => setEdit(null)}><X /></button></header>{edit.preview && row && <article className="occ-content-preview"><h3>{row.titleAr ?? row.title}</h3><p>{row.bodyAr ?? row.message}</p>{row.titleEn && <><h3 dir="ltr">{row.titleEn}</h3><p dir="ltr">{row.bodyEn}</p></>}<small>الإصدار {String(row.revision)} · {row.audience ? statuses[row.audience] : row.slug}</small></article>}{error && <div role="alert" className="occ-error">{error}</div>}<form ref={formRef} onSubmit={e => void submit(e)}><div className="occ-form-grid">{edit.fields.map(f => {
                let v = f.value ?? edit.data?.[f.key] ?? '';
                if (f.type === 'money' && v !== '')
                    v = Number(v) / 100;
                if (f.type === 'datetime-local' && v)
                    v = new Date(Number(v) - new Date(Number(v)).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                if (f.type === 'csv' && Array.isArray(v))
                    v = v.join(', ');
                return <label className={['textarea', 'checkbox'].includes(f.type ?? '') ? 'wide' : ''} key={f.key}><span>{f.label}</span>{f.type === 'textarea' ? <textarea name={f.key} defaultValue={v} required={f.required} rows={4} maxLength={20000}/> : ['select', 'roles'].includes(f.type ?? '') ? <select name={f.key} defaultValue={Array.isArray(v) ? v[0] : v || f.options?.[0]?.[0]}>{f.options?.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select> : f.type === 'checkbox' ? <input type="checkbox" name={f.key} defaultChecked={!!v}/> : <input name={f.key} type={['money', 'nullable-number'].includes(f.type ?? '') ? 'number' : f.type === 'csv' ? 'text' : f.type ?? 'text'} step={f.type === 'money' ? '0.01' : f.type === 'number' ? '1' : undefined} defaultValue={v} required={f.required} maxLength={2000}/>}</label>;
            })}<label className="wide"><span>سبب العملية / مرجع المراجعة <strong>*</strong></span><textarea name="reason" minLength={3} maxLength={1000} required rows={2} placeholder="اكتب سببًا واضحًا يظهر في سجل التدقيق"/></label></div><label className="occ-confirm"><input name="confirmed" type="checkbox" required/>راجعت الهدف والبيانات وأؤكد هذه العملية.</label>{reauth && reauthenticate && <button type="button" onClick={() => void reauthenticate()}>إعادة تسجيل الدخول للمصادقة</button>}<footer><button type="button" disabled={busy} onClick={() => setEdit(null)}>إلغاء</button><button className="occ-primary" disabled={busy} type="submit">{busy ? 'جارٍ التحقق والحفظ…' : preview ? 'تجربة الإجراء في المعاينة' : 'تأكيد وإرسال للخادم'}</button></footer></form></section></div>}
   {kycPromptRow && (
    <div className="occ-overlay">
      <section role="dialog" className="occ-modal" style={{ maxWidth: '440px' }}>
        <h2>سبب معاينة وثيقة الهوية (مطلوب)</h2>
        <p style={{ fontSize: '13px', color: 'var(--orin-muted)', margin: '8px 0 16px' }}>يجب توثيق سبب الوصول إلى صورة ورقم الوثيقة في سجل التدقيق المباشر.</p>
        <form onSubmit={e => { e.preventDefault(); void submitKycReason(kycReasonInput); }}>
          <label className="occ-field" style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>سبب المعاينة (5 أحرف على الأقل) *</span>
            <textarea
              required
              minLength={5}
              value={kycReasonInput}
              onChange={e => setKycReasonInput(e.target.value)}
              placeholder="أدخل سبب المعاينة والتدقيق (مثال: مراجعة طلب التوثيق للسحب)..."
              rows={3}
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid var(--orin-line)', background: 'var(--orin-surface-soft)', color: 'var(--orin-ink)' }}
            />
          </label>
          <div className="occ-actions" style={{ marginTop: '16px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="submit" className="occ-primary" disabled={kycReasonInput.trim().length < 5}>
              تأكيد وعرض التفاصيل
            </button>
            <button type="button" onClick={() => setKycPromptRow(null)}>
              إلغاء
            </button>
          </div>
        </form>
      </section>
    </div>
   )}
 </div>;
}

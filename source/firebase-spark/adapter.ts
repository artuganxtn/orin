import {demoWalletApi} from './demo-wallet';
import {unavailablePrograms} from '../lib/programs';
import {PERMISSIONS} from '../lib/control-center';
import {scopeAccountState} from '../lib/account-scope';
import type {LabState} from '../lib/contracts';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, limit, orderBy, runTransaction, serverTimestamp, writeBatch, startAfter, documentId, type QueryDocumentSnapshot, type Firestore, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { CAPABILITIES, DEFAULT_CONFIGURATION, DEFAULT_PREFERENCES, parsePreferences, type MarketConfiguration } from '../lib/preferences';
import { validatePreferences } from '../lib/settings-engine';
import { safeDestination } from '../lib/orin-routes';
import {experienceApi} from './experience';
import {tradingAccountsApi} from './trading-accounts';
export const FINANCIAL_UNAVAILABLE = 'تشغيل العقود وحجز الأرصدة والتسوية يحتاج خادمًا آمنًا. هذه العمليات غير متاحة في نسخة Spark الحالية، ولم يتغير رصيدك.';
const OWNER = 'khtaub7341@gmail.com';
type Data = DocumentData;
class SparkError extends Error {
    public status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}
const millis = (v: any) => v?.toMillis?.() ?? (typeof v === 'number' ? v : 0);
const object = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v);
function keys(v: Data, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k)))
    throw new SparkError('إعداد غير مسموح.'); }
const ADMIN_EMAILS = ['khtaub7341@gmail.com', 'khtaub99@gmail.com', 'mm@mm.mm'];
const legacyIsAdmin = (u: User, p?: Data) => !p?.disabled && (p?.role === 'admin' || ADMIN_EMAILS.includes(u.email?.toLowerCase().trim() ?? ''));
const campaignView = (d: Data) => ({ ...d, created_at: millis(d.createdAt), sent_at: d.sentAt ? millis(d.sentAt) : null });
/** Firestore rules are the authority. No financial writes or Admin SDK secrets run here. */
export function createSparkApi(db: Firestore, getUser: () => Promise<User | null>, programRequest?: (path:string,init:RequestInit)=>Promise<Response>) {
    const isAdmin=(u:User,p?:Data)=>legacyIsAdmin(u,p);
    const experience=experienceApi(db);
    const tradingAccounts=tradingAccountsApi(db);
    const cache = new Map<string, {
        until: number;
        value: Promise<unknown>;
    }>();
    const cached = <T>(key: string, load: () => Promise<T>, ttl = 30000): Promise<T> => { const old = cache.get(key); if (old && old.until > Date.now())
        return old.value as Promise<T>; const value = load().catch(e => { cache.delete(key); throw e; }); cache.set(key, { until: Date.now() + ttl, value }); return value; };
    const profileRef = (uid: string) => doc(db, 'sparkProfiles', uid);
    async function account(u: User) {
        return cached('account:' + u.uid, async () => {
            let p: any = (await getDoc(doc(db, 'users', u.uid))).data();
            const isOwner = ADMIN_EMAILS.includes(u.email?.toLowerCase().trim() ?? '');
            if (!p) {
                p = {
                    uid: u.uid,
                    email: u.email || '',
                    displayName: u.displayName || 'مستخدم ORIN',
                    role: isOwner ? 'admin' : 'user',
                    disabled: false
                };
                try {
                    await setDoc(doc(db, 'users', u.uid), { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
                } catch {}
            } else if (isOwner && p.role !== 'admin') {
                p.role = 'admin';
                try {
                    await setDoc(doc(db, 'users', u.uid), { role: 'admin', updatedAt: serverTimestamp() }, { merge: true });
                } catch {}
            }
            if (p.disabled)
                throw new SparkError('الوصول إلى الحساب غير متاح.', 403);
            const r = profileRef(u.uid);
            let s = await getDoc(r);
            if (!s.exists()) {
                try {
                    await runTransaction(db, async (tx) => { const current = await tx.get(r); if (!current.exists())
                        tx.set(r, { uid: u.uid, profile: { displayName: p.displayName, phone: '', country: '', closureStatus: 'open' }, preferences: DEFAULT_PREFERENCES, tier: 'standard', acceptedAt: null, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); });
                    s = await getDoc(r);
                } catch {}
            }
            const profileData = s.exists() ? s.data()! : { uid: u.uid, profile: { displayName: p.displayName, phone: '', country: '', closureStatus: 'open' }, preferences: DEFAULT_PREFERENCES, tier: 'standard', acceptedAt: null, revision: 0 };
            return { p, a: profileData };
        });
    }
    async function configuration() { return cached('configuration', async () => { const s = (await getDoc(doc(db, 'sparkConfiguration', 'markets'))).data(); return { configuration: (s?.configuration ?? JSON.parse(JSON.stringify(DEFAULT_CONFIGURATION))) as MarketConfiguration, configurationRevision: s?.revision ?? 0, updatedAt: millis(s?.updatedAt), capabilities: { ...CAPABILITIES, password: true } }; }); }
    async function optionalBackend(path: string) {
        if (!programRequest) throw new SparkError('Backend unavailable',503);
        const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
        try { return await Promise.race([programRequest(path,{signal:controller.signal}),new Promise<Response>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new SparkError('Backend timed out',504));},2000);})]); }
        finally {if(timer!==undefined)clearTimeout(timer);}
    }
    async function controlAvailable(u: User) {
        if (u.email === OWNER || u.email === 'khtaub99@gmail.com' || u.email === 'mm@mm.mm') return true;
        if (!programRequest) return false;
        return cached('control-entry:' + u.uid, async () => {
            try { const r = await optionalBackend('/api/control/session'); if (!r.ok) return false;
                return (await r.json() as {available?:boolean}).available === true;
            } catch { return false; }
        }, 30000);
    }
    async function settings(u: User) { const [{ p, a }, c] = await Promise.all([account(u), configuration()]); return { ...c, preferences: parsePreferences(a.preferences, c.configuration), profile: { ...a.profile, displayName: p.displayName }, revision: a.revision, updatedAt: millis(a.updatedAt), isAdmin: isAdmin(u, p), controlAvailable: await controlAvailable(u), email: u.email, clientId: u.uid }; }
    async function saveSettings(u: User, input: Data) {
        keys(input, ['revision', 'preferences', 'profile', 'closeAccount']);
        const current = await settings(u);
        const patch = input.preferences ?? {};
        if (!object(patch))
            throw new SparkError('إعدادات غير صالحة.');
        validatePreferences(patch, current.configuration);
        const profile = { ...current.profile };
        if (input.profile !== undefined) {
            if (!object(input.profile))
                throw new SparkError('بيانات غير صالحة.');
            keys(input.profile, ['displayName', 'phone', 'country']);
            for (const [k, v] of Object.entries(input.profile)) {
                if (typeof v !== 'string')
                    throw new SparkError('بيانات غير صالحة.');
                const t = v.trim();
                if (k === 'displayName' && (!t || t.length > 100) || k === 'phone' && t !== '' && !/^\+?[0-9 ()-]{6,24}$/.test(t) || k === 'country' && t !== '' && !/^[A-Z]{2}$/.test(t))
                    throw new SparkError('تحقق من بيانات الحساب.');
                (profile as Data)[k] = t;
            }
        }
        if (input.closeAccount !== undefined) {
            if (input.closeAccount !== true)
                throw new SparkError('التأكيد مطلوب.');
            profile.closureStatus = 'requested';
        }
        await runTransaction(db, async (tx) => { const r = profileRef(u.uid), s = (await tx.get(r)).data()!; if (s.revision !== input.revision)
            throw new SparkError('تغيرت الإعدادات. أعد تحميلها.', 409); const preferences = parsePreferences({ ...s.preferences, ...patch, notificationEvents: { ...s.preferences.notificationEvents, ...patch.notificationEvents } }, current.configuration); tx.update(r, { profile, preferences, revision: s.revision + 1, updatedAt: serverTimestamp() }); if (input.profile?.displayName)
            tx.update(doc(db, 'users', u.uid), { displayName: profile.displayName, updatedAt: serverTimestamp() }); });
        cache.clear();
        return settings(u);
    }
    async function saveConfiguration(u: User, input: Data) { const { p } = await account(u); if (!isAdmin(u, p))
        throw new SparkError('هذه العملية للإدارة فقط.', 403); keys(input, ['revision', 'configuration']); if (!object(input.configuration))
        throw new SparkError('إعدادات غير صالحة.'); keys(input.configuration, Object.keys(DEFAULT_CONFIGURATION)); await runTransaction(db, async (tx) => { const r = doc(db, 'sparkConfiguration', 'markets'), s = (await tx.get(r)).data(); if ((s?.revision ?? 0) !== input.revision)
        throw new SparkError('تغيرت إعدادات الإدارة. أعد التحميل.', 409); tx.set(r, { configuration: input.configuration, revision: input.revision + 1, updatedAt: serverTimestamp() }); }); cache.clear(); return configuration(); }
    async function notices(u: User) {
        return cached('inbox:' + u.uid, async () => {
            const { a } = await account(u), rows = await getDocs(collection(db, 'sparkProfiles', u.uid, 'inbox'));
            if (!a.preferences.marketingNotifications || !a.preferences.notificationEvents.announcement)
                return [];
            const items = await Promise.all(rows.docs.map(async (row) => { const pointer = row.data(), n = (await getDoc(doc(db, 'sparkAnnouncements', row.id))).data(); return n && n.expires_at > Date.now() ? { id: row.id, title: n.title, message: n.message, created_at: millis(n.createdAt), contract_id: null, category: 'announcement', deep_link: safeDestination(n.deep_link), read_at: pointer.readAt ? millis(pointer.readAt) : null, archived_at:pointer.archivedAt?millis(pointer.archivedAt):null, image: n.image || null } : null; }));
            return items.filter((n): n is NonNullable<typeof n> => !!n).sort((a, b) => b.created_at - a.created_at);
        });
    }
    async function inbox(u: User, url: URL) { const all = await notices(u), items=all.filter(n=>url.searchParams.get('archived')==='true'?!!n.archived_at:!n.archived_at), offset = Number(url.searchParams.get('offset') ?? 0), key = url.searchParams.get('id'); if (!Number.isSafeInteger(offset) || offset < 0)
        throw new SparkError('طلب غير صالح.'); return { items: key ? all.filter(n => n.id === key) : items.slice(offset, offset + 50), unreadCount: all.filter(n => n.read_at === null&&!n.archived_at).length, total: items.length, serverTime: Date.now(), pushAvailable: false }; }
    async function readNotices(u: User, input: Data) { const items = await notices(u); if(input.action==='archive'||input.action==='restore'){if(typeof input.id!=='string'||!items.some(n=>n.id===input.id))throw new SparkError('الإشعار غير متاح.',404);const batch=writeBatch(db);batch.update(doc(db,'sparkProfiles',u.uid,'inbox',input.id),{archivedAt:input.action==='archive'?serverTimestamp():null});await batch.commit();cache.delete('inbox:'+u.uid);return inbox(u,new URL('https://orin.invalid/api/notifications'+(input.action==='restore'?'?archived=true':'')));} if (input.all !== true && (typeof input.id !== 'string' || !items.some(n => n.id === input.id)))
        throw new SparkError('الإشعار غير متاح.', 404); const targets = items.filter(n => !n.read_at && (input.all === true || n.id === input.id)); for (let i = 0; i < targets.length; i += 400) {
        const b = writeBatch(db);
        for (const n of targets.slice(i, i + 400))
            b.update(doc(db, 'sparkProfiles', u.uid, 'inbox', n.id), { readAt: serverTimestamp() });
        await b.commit();
    } cache.delete('inbox:' + u.uid); return inbox(u, new URL('https://orin.invalid/api/notifications')); }
    async function listCampaigns(u: User) { const { p } = await account(u); if (!isAdmin(u, p))
        throw new SparkError('هذه العملية للإدارة فقط.', 403); return { campaigns: (await getDocs(query(collection(db, 'sparkCampaigns'), orderBy('createdAt', 'desc'), limit(100)))).docs.map(d => campaignView(d.data())), pushAvailable: false, schedulerAvailable: false }; }
    async function audience(c: Data) { async function pages(name: string) { const docs: QueryDocumentSnapshot[] = []; let cursor: QueryDocumentSnapshot | undefined; for (;;) {
        const page = await getDocs(query(collection(db, name), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(100)));
        docs.push(...page.docs);
        if (docs.length > 1000)
            throw new SparkError('الحملة تحتاج تجهيز إرسال أكبر قبل المتابعة.', 409);
        if (page.size < 100)
            break;
        cursor = page.docs[page.docs.length-1];
    } return docs; } const a = JSON.parse(c.audience), [rows, profiles] = await Promise.all([pages('sparkProfiles'), pages('users')]); const active = new Set(profiles.filter(d => !d.data().disabled).map(d => d.id)); const recipients = rows.filter(d => { const s = d.data(); return active.has(d.id) && s.profile.closureStatus === 'open' && s.preferences.marketingNotifications === true && s.preferences.notificationEvents.announcement !== false && (!a.country || a.country === s.profile.country) && (a.tier === 'all' || a.tier === s.tier) && (c.language === 'all' || c.language === s.preferences.chartLocale) && (!a.users.length || a.users.includes(d.id)); }).map(d => d.id); if (recipients.length > 200)
        throw new SparkError('الحد الحالي 200 مستلم للحملة. ضيّق الجمهور.', 409); return recipients; }
    async function campaign(u: User, input: Data) {
        const { p } = await account(u);
        if (!isAdmin(u, p))
            throw new SparkError('هذه العملية للإدارة فقط.', 403);
        const op = input.action ?? 'draft', id = input.id ?? crypto.randomUUID();
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id))
            throw new SparkError('معرّف غير صالح.');
        const r = doc(db, 'sparkCampaigns', id), previous = (await getDoc(r)).data();
        if (op === 'draft') {
            if (previous && (previous.status !== 'draft' || previous.revision !== input.revision))
                throw new SparkError('تغيرت المسودة. أعد التحميل.', 409);
            const a = input.audience, title = String(input.title ?? '').trim(), message = String(input.message ?? '').trim(), now = Date.now(), starts = Number(input.startsAt ?? now), expires = Number(input.expiresAt ?? now + 604800000), link = safeDestination(input.deepLink), image = String(input.image ?? '');
            if (!title || title.length > 80 || !message || message.length > 500 || !object(a) || typeof a.country !== 'string' || a.country !== '' && !/^[A-Z]{2}$/.test(a.country) || !['all', 'standard', 'advanced'].includes(a.tier) || !Array.isArray(a.users) || a.users.length > 100 || a.users.some((v: unknown) => typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(v)) || !['ar', 'en', 'all'].includes(input.language) || !Number.isSafeInteger(starts) || !Number.isSafeInteger(expires) || expires <= Math.max(now, starts) || expires - now > 90 * 86400000 || input.deepLink && link !== input.deepLink || image && !/^\/brand\/[A-Za-z0-9/_.-]+\.(png|jpg|webp|svg)$/.test(image) || image.includes('..'))
                throw new SparkError('راجع محتوى الإعلان والجمهور والموعد.');
            const saved = { id, title, message, image, audience: JSON.stringify(a), language: input.language, deep_link: link, starts_at: starts, expires_at: expires, status: 'draft', revision: (previous?.revision ?? -1) + 1, createdAt: previous?.createdAt ?? serverTimestamp(), sentAt: null, recipient_count: 0, recipientIds: [] };
            await runTransaction(db, async (tx) => { const s = (await tx.get(r)).data(); if (s && (s.status !== 'draft' || s.revision !== input.revision))
                throw new SparkError('تغيرت المسودة.', 409); tx.set(r, saved); });
            return { campaign: campaignView((await getDoc(r)).data()!) };
        }
        if (!previous)
            throw new SparkError('الحملة غير موجودة.', 404);
        if (op === 'preview')
            return { campaign: campaignView(previous), recipientCount: (await audience(previous)).length };
        if (!['send', 'cancel'].includes(op))
            throw new SparkError('عملية غير مدعومة.');
        if (previous.status !== 'draft' || previous.revision !== input.revision)
            throw new SparkError('تغيرت الحملة أو اكتمل إرسالها.', 409);
        const recipients = op === 'send' ? await audience(previous) : [];
        if (op === 'send' && (input.confirmed !== true || Date.now() < previous.starts_at || Date.now() >= previous.expires_at || !recipients.length || recipients.length !== input.expectedRecipients))
            throw new SparkError('راجع الموعد والجمهور وأكّد الإرسال بعد المعاينة.', 409);
        await runTransaction(db, async (tx) => { const c = (await tx.get(r)).data()!; if (c.status !== 'draft' || c.revision !== input.revision)
            throw new SparkError('تغيرت الحملة أو اكتمل إرسالها.', 409); tx.update(r, { status: op === 'send' ? 'sent' : 'cancelled', revision: c.revision + 1, ...(op === 'send' ? { recipientIds: recipients, recipient_count: recipients.length, sentAt: serverTimestamp() } : {}) }); if (op === 'send') {
            tx.set(doc(db, 'sparkAnnouncements', id), { id, title: c.title, message: c.message, image: c.image, deep_link: c.deep_link, expires_at: c.expires_at, createdAt: serverTimestamp() });
            for (const uid of recipients)
                tx.set(doc(db, 'sparkProfiles', uid, 'inbox', id), { campaignId: id, createdAt: serverTimestamp(), readAt: null });
        } });
        cache.clear();
        return listCampaigns(u);
    }
    async function lab(u: User) { return cached('lab:' + u.uid, async () => { const { p, a } = await account(u), legacy = (await getDoc(doc(db, 'orinAccounts', u.uid))).data(), admin = isAdmin(u, p), feed = await notices(u); const getOwn = async (name: string) => (await getDocs(query(collection(db, name), where('user_id', '==', u.uid), limit(100)))).docs.map(d => d.data()); const contracts = (await getDocs(query(collection(db, 'orinContracts'), ...(admin ? [] : [where('eligibility', 'in', ['all', a.tier || 'standard'])]), limit(100)))).docs.map(d => d.data()); const [positions, receipts, journals, audits] = await Promise.all([getOwn('orinPositions'), getOwn('orinReceipts'), getOwn('orinJournals'), admin ? getDocs(query(collection(db, 'orinAudit'), limit(100))).then(s => s.docs.map(d => d.data())) : Promise.resolve([])]); const data={ serverTime: Date.now(), user: { id: u.uid, name: p.displayName, tier: a.tier, accepted_at: millis(a.acceptedAt) || null, seen_at: 0 }, isAdmin: admin, balanceCents: legacy?.balanceCents ?? 0, reservedCents: legacy?.reservedCents ?? 0, realizedCents: legacy?.realizedCents ?? 0, initialCents: 0, contracts, positions, receipts, ledger: journals.flatMap(d => d.entries), audit: audits, notifications: feed, financialOperations: false, accountDirectory: await tradingAccounts(u.uid).catch(() => null) }; const scoped=data.accountDirectory?scopeAccountState(data as unknown as LabState,data.accountDirectory):data;const selected=data.accountDirectory?.accounts.find(a=>a.id===data.accountDirectory?.activeId);if(programRequest&&selected?.type==='real'){try{const result=await optionalBackend('/api/account-activity?accountId='+encodeURIComponent(selected.id));if(!result.ok)throw new SparkError('Account activity unavailable',result.status);const activity=await result.json() as {ledger?:unknown};if(!Array.isArray(activity.ledger))throw new SparkError('Invalid account activity',503);scoped.ledger=activity.ledger;}catch{(scoped as LabState).activityUnavailable=true;console.warn('ORIN_ACCOUNT_ACTIVITY_UNAVAILABLE',{accountId:selected.id});}}return scoped; }, 60000); }
    async function action(u: User, input: Data) {
        if (programRequest && ['publish', 'join', 'settle'].includes(input.action)) {
            try {
                const res = await programRequest('/api/lab', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(input)
                });
                if (res.ok) {
                    cache.delete('lab:' + u.uid);
                    return await res.json();
                }
            } catch (err) {
                // Fallback to local Firestore engine below
            }
        }
        if (input.action === 'publish') {
            const { p } = await account(u);
            if (!isAdmin(u, p)) throw new SparkError('هذه العملية للإدارة فقط.', 403);
            const title = String(input.title ?? '').trim() || 'صفقة تداول معتمدة';
            const asset = String(input.asset ?? 'BTCUSD');
            const direction = String(input.direction ?? 'BUY');
            const durationSec = Number(input.durationSec ?? 60);
            const settlementBps = Math.round(Number(input.settlementBps ?? 8400));
            const eligibility = String(input.eligibility ?? 'all');
            const opensAt = Number(input.opensAt ?? Date.now());
            const closesAt = Number(input.closesAt ?? (opensAt + 86400000));
            
            const id = 'c-' + Math.random().toString(36).substring(2, 10);
            const codeNum = Math.floor(1000 + Math.random() * 9000);
            const codeNum2 = Math.floor(1000 + Math.random() * 9000);
            const code = `ORIN-${codeNum}-${codeNum2}`;
            const canonical = JSON.stringify({ asset, closes_at: closesAt, direction, duration_sec: durationSec, eligibility, id, opens_at: opensAt, settlement_bps: settlementBps, title });
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))].map(v => v.toString(16).padStart(2, '0')).join('');
            
            const contract = {
                id,
                code,
                title,
                asset,
                direction,
                duration_sec: durationSec,
                settlement_bps: settlementBps,
                eligibility,
                opens_at: opensAt,
                closes_at: closesAt,
                published_at: Date.now(),
                admin_id: u.uid,
                canonical,
                hash,
                participants: 0
            };
            
            await setDoc(doc(db, 'orinContracts', id), contract);
            await setDoc(doc(db, 'orinCodes', code), { contractId: id, code, createdAt: serverTimestamp() });
            cache.delete('lab:' + u.uid);
            return { result: { id, code, ok: true }, state: await lab(u) };
        }
        if (input.action === 'join' || input.action === 'settle') {
            throw new SparkError(FINANCIAL_UNAVAILABLE, 503);
        }
        if (input.action === 'read') {
            await readNotices(u, { all: true });
            return { result: { ok: true }, state: await lab(u) };
        }
        if (!['accept', 'tier'].includes(input.action))
            throw new SparkError('عملية غير مدعومة.');
        const { p } = await account(u);
        if (input.action === 'tier' && (!isAdmin(u, p) || !['standard', 'advanced'].includes(input.tier)))
            throw new SparkError('هذه العملية للإدارة فقط.', 403);
        await runTransaction(db, async (tx) => {
            const r = profileRef(u.uid), s = (await tx.get(r)).data()!;
            tx.update(r, { ...(input.action === 'tier' ? { tier: input.tier } : { acceptedAt: s.acceptedAt ?? serverTimestamp() }), revision: s.revision + 1, updatedAt: serverTimestamp() });
        });
        cache.clear();
        return { result: { ok: true }, state: await lab(u) };
    }
    return async (path: string, init: RequestInit = {}) => {
        try {
            if (!path.startsWith('/api/') || path.includes('://'))
                throw new SparkError('وجهة غير صالحة.');
            const u = await getUser();
            if (!u)
                throw new SparkError('سجّل الدخول للمتابعة.', 401);
            await account(u);
            const url = new URL(path, 'https://orin.invalid'), method = init.method ?? 'GET';
            let data: any, input: Data = {};
            if (method !== 'GET') {
                if (typeof init.body !== 'string' || init.body.length > (url.pathname==='/api/experience/avatar'?65000:url.pathname==='/api/kyc'?250000:url.pathname.startsWith('/api/control/')?50000:12000))
                    throw new SparkError('طلب غير صالح.');
                input = JSON.parse(init.body);
                if (!object(input))
                    throw new SparkError('طلب غير صالح.');
            }
            if(url.pathname.startsWith('/api/control/')){
                const isDirectControl = ['/api/control/session', '/api/control/accept-invitation', '/api/control/accounts', '/api/control/wallets', '/api/control/kyc', '/api/control/kyc-document'].includes(url.pathname) || (url.pathname === '/api/control/action' && (input?.action?.startsWith('account.') || input?.action?.startsWith('wallet.') || input?.action?.startsWith('user.') || input?.action?.startsWith('kyc.')));
                if(programRequest && !isDirectControl){
                    try {
                        const res = await programRequest(path, init);
                        if (res.ok) {
                            const data = await res.json();
                            return Response.json(data);
                        }
                    } catch(e) {
                        console.warn('Control programRequest failed:', e);
                    }
                }
                const {p} = await account(u);
                const admin = isAdmin(u, p);
                if(url.pathname==='/api/control/session'||url.pathname==='/api/control/accept-invitation'){
                    if(admin) {
                        return Response.json({
                            available: true,
                            uid: u.uid,
                            roles: ['super_admin'],
                            permissions: Object.keys(PERMISSIONS),
                            reauthSeconds: 300,
                            capabilities: { payments: true, execution: true, kycDocuments: true, push: true, scheduler: true }
                        });
                    }
                    return Response.json({available:false,roles:[],permissions:[],reason:'unauthorized',reauthSeconds:300,capabilities:{payments:false,execution:false,kycDocuments:false,push:false,scheduler:false}}, {status: 403});
                }
                if(admin && (url.pathname === '/api/control/accounts' || url.pathname === '/api/control/wallets')) {
                    const userDocs = await getDocs(collection(db, 'users'));
                    const accountsList: any[] = [];
                    for (const uDoc of userDocs.docs) {
                        const uData = uDoc.data();
                        try {
                            const acctDocs = await getDocs(collection(db, 'sparkTradingAccounts', uDoc.id, 'accounts'));
                            for (const aDoc of acctDocs.docs) {
                                const aData = aDoc.data();
                                accountsList.push({
                                    id: aDoc.id,
                                    ownerId: uDoc.id,
                                    email: uData.email || '',
                                    displayName: uData.displayName || '',
                                    accountNumber: aData.accountNumber || aDoc.id,
                                    type: aData.type || 'real',
                                    currency: aData.currency || 'USD',
                                    balanceCents: aData.balanceCents ?? 0,
                                    cashCents: aData.balanceCents ?? 0,
                                    bonusCents: aData.bonusCents ?? 0,
                                    profitCents: aData.profitCents ?? 0,
                                    withdrawableProfitCents: aData.withdrawableProfitCents ?? aData.profitCents ?? 0,
                                    status: aData.status || 'active',
                                    createdAt: aData.createdAt?.toMillis?.() ?? Date.now(),
                                    revision: aData.revision ?? 0
                                });
                            }
                        } catch {}
                    }
                    return Response.json({ rows: accountsList, nextCursor: null, total: accountsList.length });
                }
                if(admin && url.pathname === '/api/control/users') {
                    const userDocs = await getDocs(collection(db, 'users'));
                    const usersList = userDocs.docs.map(d => {
                        const data = d.data();
                        return {
                            id: d.id,
                            uid: d.id,
                            email: data.email || '',
                            displayName: data.displayName || 'مستخدم ORIN',
                            role: data.role || 'user',
                            status: data.disabled ? 'suspended' : 'active',
                            createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
                            revision: data.revision ?? 0
                        };
                    });
                    return Response.json({ rows: usersList, nextCursor: null, total: usersList.length });
                }
                if(admin && url.pathname === '/api/control/action' && method === 'POST') {
                    const act = input?.action;
                    const target = input?.target;
                    const payload = input?.data || {};
                    if (act === 'account.balance' || act === 'wallet.adjust' || act === 'finance.adjust') {
                        throw new SparkError('تعديل الأرصدة يتطلب الخادم الآمن. / Balance adjustments must use the server backend.', 403);
                    }
                    if (act === 'account.delete' || act === 'account.close') {
                        const uid = payload.uid || payload.ownerId;
                        const accountId = target || payload.accountId;
                        if (uid && accountId) {
                            try {
                                const aDoc = await getDoc(doc(db, 'sparkTradingAccounts', uid, 'accounts', accountId));
                                if (aDoc.exists()) {
                                    const num = aDoc.data()?.accountNumber;
                                    if (num) await deleteDoc(doc(db, 'sparkAccountNumbers', num)).catch(() => {});
                                }
                            } catch {}
                            await deleteDoc(doc(db, 'sparkTradingAccounts', uid, 'accounts', accountId));
                            return Response.json({ saved: true, success: true, deleted: true });
                        }
                    }
                    if (act === 'account.status') {
                        const uid = payload.uid || payload.ownerId;
                        const accountId = target || payload.accountId;
                        if (uid && accountId) {
                            await updateDoc(doc(db, 'sparkTradingAccounts', uid, 'accounts', accountId), { status: payload.status, updatedAt: serverTimestamp() });
                            return Response.json({ saved: true, success: true });
                        }
                    }
                    if (act === 'account.create') {
                        const uid = target || payload.uid || payload.ownerId || payload._target;
                        const type = payload.type || 'real';
                        if (payload.balanceCents !== undefined || payload.balance !== undefined) {
                            throw new SparkError('تعديل الأرصدة يتطلب الخادم الآمن. / Balance adjustments must use the server backend.', 403);
                        }
                        const balanceCents = 0;
                        const accountId = 'acct-' + Math.random().toString(36).substring(2, 10);
                        const number = String(Math.floor(100000000000 + Math.random() * 900000000000));
                        await setDoc(doc(db, 'sparkTradingAccounts', uid, 'accounts', accountId), {
                            id: accountId,
                            ownerId: uid,
                            accountNumber: number,
                            type,
                            currency: 'USD',
                            balanceCents,
                            reservedCents: 0,
                            realizedCents: 0,
                            status: 'active',
                            createdAt: serverTimestamp()
                        });
                        await setDoc(doc(db, 'sparkAccountNumbers', number), { ownerId: uid, accountId }).catch(() => {});
                        return Response.json({ saved: true, success: true, accountId, accountNumber: number });
                    }
                    if (act === 'user.status') {
                        await updateDoc(doc(db, 'users', target), { disabled: payload.status === 'suspended', status: payload.status, updatedAt: serverTimestamp() });
                        return Response.json({ saved: true, success: true });
                    }
                    if (act === 'kyc.review') {
                        const kycId = target || payload.id;
                        const newStatus = payload.status || 'verified';
                        const reason = payload.reason || input?.reason || '';
                        if (kycId) {
                            const kRef = doc(db, 'orinKycRequests', kycId);
                            const kSnap = await getDoc(kRef);
                            const kData = kSnap.data();
                            await updateDoc(kRef, {
                                status: newStatus,
                                reviewedBy: u.email || 'Admin',
                                reason,
                                updatedAt: serverTimestamp(),
                                revision: (kData?.revision ?? 0) + 1
                            });
                            const targetUid = kData?.uid || (kycId.startsWith('kyc-') ? kycId.replace('kyc-', '') : null);
                            if (targetUid) {
                                await updateDoc(doc(db, 'users', targetUid), {
                                    kycStatus: newStatus,
                                    updatedAt: serverTimestamp()
                                }).catch(() => {});
                            }
                            return Response.json({ saved: true, success: true, status: newStatus });
                        }
                    }
                    return Response.json({ saved: true, success: true });
                }
                if(admin && url.pathname === '/api/control/kyc') {
                    try {
                        const kycDocs = await getDocs(query(collection(db, 'orinKycRequests'), orderBy('createdAt', 'desc'), limit(50)));
                        const kycList = kycDocs.docs.map(d => {
                            const data = d.data();
                            return {
                                id: d.id,
                                uid: data.uid || '',
                                userEmail: data.userEmail || '',
                                fullName: data.fullName || '',
                                documentType: data.documentType || 'id_card',
                                idNumber: data.idNumber || '',
                                country: data.country || '',
                                documentImage: data.documentImage || '',
                                documentIds: data.documentIds || ['doc-1'],
                                status: data.status || 'review',
                                reviewedBy: data.reviewedBy || '',
                                reason: data.reason || '',
                                createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
                                updatedAt: data.updatedAt?.toMillis?.() ?? Date.now(),
                                revision: data.revision ?? 0
                            };
                        });
                        return Response.json({ rows: kycList, nextCursor: null, total: kycList.length });
                    } catch {
                        return Response.json({ rows: [], nextCursor: null, total: 0 });
                    }
                }
                if(admin && url.pathname === '/api/control/kyc-document') {
                    const id = url.searchParams.get('id');
                    if (id) {
                        const kDoc = await getDoc(doc(db, 'orinKycRequests', id));
                        if (kDoc.exists()) {
                            const img = kDoc.data()?.documentImage;
                            if (img && img.startsWith('data:image/')) {
                                const parts = img.split(',');
                                const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
                                const binary = atob(parts[1]);
                                const array = new Uint8Array(binary.length);
                                for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
                                return new Response(array, {
                                    headers: { 'Content-Type': mime, 'Content-Disposition': `inline; filename="${id}.jpg"` }
                                });
                            }
                        }
                    }
                    return new Response('Document not found', { status: 404 });
                }
                if(admin) {
                    return Response.json({ rows: [], nextCursor: null, total: 0 });
                }
                throw new SparkError('لوحة التحكم تحتاج الخادم الموثوق. / Trusted backend required.',503);
            }
            if(programRequest&&['/api/programs','/api/admin/programs'].includes(url.pathname))return programRequest(path,init);
            if(url.pathname === '/api/programs'){if(method!=='GET')throw new SparkError('البرنامج بانتظار تفعيل الخادم الموثوق. / Program backend is not active.',409);data=unavailablePrograms();}
            else if(url.pathname === '/api/admin/programs'){const {p}=await account(u);if(!isAdmin(u,p))throw new SparkError('Administrator access required',403);if(method!=='GET')throw new SparkError('الخادم المالي غير متصل. / Financial backend is not connected.',409);data={available:false,configuration:unavailablePrograms().config,rewards:[],members:[],audit:[]};}
            else if(url.pathname === '/api/demo-wallet'){data=await demoWalletApi(db)(u.uid,method,method==='GET'?{accountId:url.searchParams.get('accountId')}:input);if(method!=='GET')cache.delete('lab:'+u.uid);}
            else if(url.pathname === '/api/trading-accounts'){data=await tradingAccounts(u.uid,method,input);if(method!=='GET')cache.delete('lab:'+u.uid);}
            else if(url.pathname.startsWith('/api/experience/')){data=method==='GET'?await cached('experience:'+u.uid+url.pathname,()=>experience(u,url.pathname.slice('/api/experience/'.length),method,input)):await experience(u,url.pathname.slice('/api/experience/'.length),method,input);if(method!=='GET')cache.clear();}
            else if (url.pathname === '/api/kyc') {
                if (method === 'GET') {
                    let kDoc = await getDoc(doc(db, 'orinKycRequests', `kyc-${u.uid}`));
                    if (!kDoc.exists()) {
                        kDoc = await getDoc(doc(db, 'orinKycRequests', u.uid));
                    }
                    if (kDoc.exists()) {
                        const kd = kDoc.data()!;
                        data = {
                            exists: true,
                            status: kd.status || 'review',
                            request: {
                                fullName: kd.fullName || '',
                                documentType: kd.documentType || 'id_card',
                                idNumber: kd.idNumber || '',
                                country: kd.country || '',
                                status: kd.status || 'review',
                                reason: kd.reason || '',
                                reviewedBy: kd.reviewedBy || '',
                                createdAt: millis(kd.createdAt),
                                updatedAt: millis(kd.updatedAt),
                                hasImage: !!kd.documentImage
                            }
                        };
                    } else {
                        const { p } = await account(u);
                        data = {
                            exists: false,
                            status: p.kycStatus || 'unverified'
                        };
                    }
                } else if (method === 'POST') {
                    const fullName = String(input.fullName ?? '').trim();
                    const documentType = String(input.documentType ?? 'id_card');
                    const idNumber = String(input.idNumber ?? '').trim();
                    const country = String(input.country ?? '').trim();
                    const documentImage = typeof input.documentImage === 'string' ? input.documentImage : '';

                    if (!fullName || fullName.length < 2 || fullName.length > 100)
                        throw new SparkError('يرجى كتابة الاسم الكامل كما في وثيقة الهوية.');
                    if (!idNumber || idNumber.length < 3 || idNumber.length > 50)
                        throw new SparkError('يرجى كتابة رقم الوثيقة بشكل صحيح.');
                    if (!country)
                        throw new SparkError('يرجى تحديد دولة الوثيقة.');
                    if (!documentImage || !documentImage.startsWith('data:image/'))
                        throw new SparkError('يرجى إرفاق صورة واضحة للوثيقة.');

                    const kycId = `kyc-${u.uid}`;
                    await setDoc(doc(db, 'orinKycRequests', kycId), {
                        id: kycId,
                        uid: u.uid,
                        fullName,
                        documentType,
                        idNumber,
                        country,
                        documentImage,
                        documentIds: ['doc-1'],
                        status: 'review',
                        reason: '',
                        reviewedBy: '',
                        userEmail: u.email || '',
                        userDisplayName: u.displayName || fullName,
                        revision: 0,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    }, { merge: true });

                    await updateDoc(doc(db, 'users', u.uid), {
                        kycStatus: 'review',
                        updatedAt: serverTimestamp()
                    }).catch(() => {});

                    data = { success: true, status: 'review', message: 'تم إرسال طلب التوثيق بنجاح.' };
                }
            }
            else if (url.pathname === '/api/settings')
                data = method === 'GET' ? await settings(u) : method === 'PATCH' ? await saveSettings(u, input) : undefined;
            else if (url.pathname === '/api/markets/configuration')
                data = method === 'GET' ? await configuration() : method === 'PATCH' ? await saveConfiguration(u, input) : undefined;
            else if (url.pathname === '/api/notifications')
                data = method === 'GET' ? await inbox(u, url) : method === 'POST' ? await readNotices(u, input) : undefined;
            else if (url.pathname === '/api/admin/notifications')
                data = method === 'GET' ? await listCampaigns(u) : method === 'POST' ? await campaign(u, input) : undefined;
            else if (url.pathname === '/api/lab') {
                if(method==='GET'&&init.cache==='no-store')cache.delete('lab:'+u.uid);
                data = method === 'GET' ? await lab(u) : method === 'POST' ? await action(u, input) : undefined;
            } else if (url.pathname === '/api/invitations/verify' && method === 'POST') {
                const value = String(input.code ?? '').trim().toUpperCase();
                if (!value || value.length < 3 || value.length > 40)
                    throw new SparkError('كود الدعوة غير صالح.');
                const candidates = [value];
                if (!value.startsWith('LAB-')) candidates.push(`LAB-${value}`);

                if (programRequest) {
                    for (const candidate of candidates) {
                        try {
                            const res = await programRequest('/api/invitations/verify', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ code: candidate })
                            });
                            if (res.ok) {
                                return res;
                            }
                        } catch {
                            // Fallback to local Firestore verification below
                        }
                    }
                }
                
                const state = await lab(u);
                let contract: any = null;
                for (const candidate of candidates) {
                    contract = state.contracts.find(c => c.code === candidate);
                    if (!contract) {
                        const snap = await getDocs(query(collection(db, 'orinContracts'), where('code', '==', candidate), limit(1)));
                        if (!snap.empty) contract = snap.docs[0].data();
                    }
                    if (!contract) {
                        const codeDoc = await getDoc(doc(db, 'orinCodes', candidate));
                        if (codeDoc.exists()) {
                            const cDoc = await getDoc(doc(db, 'orinContracts', codeDoc.data()?.contractId));
                            if (cDoc.exists()) contract = cDoc.data();
                        }
                    }
                    if (contract) break;
                }
                if (!contract)
                    throw new SparkError('لا توجد دعوة متاحة بهذا الكود.', 404);
                
                const { p, a } = await account(u);
                const admin = isAdmin(u, p);
                const userTier = a.tier || 'standard';
                if (contract.eligibility !== 'all' && contract.eligibility !== userTier && !admin)
                    throw new SparkError('هذا الكود مخصص لفئة حساب أخرى.', 403);
                
                const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contract.canonical)))].map(v => v.toString(16).padStart(2, '0')).join('');
                if (digest !== contract.hash)
                    throw new SparkError('تعذر التحقق من سلامة العقد.', 409);
                data = { contract, serverTime: Date.now() };
            }
            if (data === undefined)
                throw new SparkError('المسار غير متاح.', 404);
            return Response.json(data);
        }
        catch (e) {
            const error = e as {
                status?: number;
                code?: string;
                message: string;
            };
            const status = error.status ?? (error.code === 'permission-denied' ? 403 : 503);
            return Response.json({ error: status === 403 ? 'ليس لديك صلاحية لهذه العملية.' : error.status ? error.message : 'تعذر الاتصال بالخدمة. أعد المحاولة.' }, { status });
        }
    };
}

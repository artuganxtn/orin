'use client';
import {NotificationList} from './notification-list';
import type {NoticeFilter} from '@/lib/notification-presentation';
import {displayText} from '../lib/display-text';
import { firebaseMode, signInUrl, signOutUrl } from '@/lib/client-api';
import { apiFetch } from '@/lib/client-api';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, ShieldCheck, RefreshCw } from 'lucide-react';
import { useOrin } from './orin-settings';
import { useNavigation } from './orin-navigation';
import { FullPage, FullPageContent, FullPageHeader, FullPageTitle, FullPageDescription } from './full-page';
import type { InboxNotice, InboxState, NoticeCategory } from '@/lib/notification-model';
export const categoryNames: Record<NoticeCategory, [
    string,
    string
]> = { opportunity: ['الفرص', 'Opportunities'], financial: ['المالية', 'Financial'], security: ['الأمان', 'Security'], announcement: ['الإعلانات', 'Announcements'], reminder: ['التذكيرات', 'Reminders'], referral: ['الإحالات', 'Referrals'], support: ['الدعم', 'Support'] };
type Context = {
    data: InboxState | null;
    error: string;
    loading: boolean;
    guest: boolean;
    reload: () => Promise<void>;
    read: (id?: string) => Promise<boolean>;
    more: () => Promise<void>;
    archived:boolean;setArchived:(value:boolean)=>void;archive:(id:string)=>Promise<void>;
};
const Inbox = createContext<Context | null>(null);
export function NotificationProvider({ children }: {
    children: ReactNode;
}) {
    const [data, setData] = useState<InboxState | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [guest, setGuest] = useState(false);
    const seq = useRef(0);
    const [archived,setArchived]=useState(false);
    const { status } = useOrin();
    const reload = useCallback(async () => { const n = ++seq.current; try {
        const r = await apiFetch('/api/notifications'+(archived?'?archived=true':''), { cache: 'no-store' });
        if (n !== seq.current)
            return;
        if (r.status === 401) {
            setGuest(true);
            setData(null);
            setError('');
            return;
        }
        const d = await r.json() as InboxState & {
            error?: string;
        };
        if (n !== seq.current)
            return;
        if (!r.ok)
            throw new Error(d.error);
        setData(d);
        setError('');
        setGuest(false);
    }
    catch (e) {
        if (n === seq.current)
            setError(e instanceof Error ? e.message : 'Unable to load notifications');
    }
    finally {
        if (n === seq.current)
            setLoading(false);
    } }, [archived]);
    useEffect(() => { void reload(); const timer = setInterval(() => { if (!document.hidden && navigator.onLine)
        void reload(); }, 60000); const focus = () => { if (!document.hidden && navigator.onLine)
        void reload(); }; document.addEventListener('visibilitychange', focus); addEventListener('focus', focus); return () => { seq.current++; clearInterval(timer); removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); }; }, [reload, status]);
    const read = async (id?: string) => { seq.current++; try {
        const r = await apiFetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id ? { id } : { all: true }) });
        const d = await r.json() as InboxState & {
            error?: string;
        };
        if (!r.ok)
            throw new Error(d.error);
        if(archived)await reload();else setData(d);
        setError('');
        return true;
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Read state was not saved');
        return false;
    } };
    const more = async () => { if (!data)
        return; try {
        const r = await apiFetch('/api/notifications?offset=' + data.items.length+(archived?'&archived=true':''), { cache: 'no-store' }), d = await r.json() as InboxState & {
            error?: string;
        };
        if (!r.ok)
            throw new Error(d.error);
        setData(previous => previous ? { ...d, items: [...new Map([...previous.items, ...d.items].map((n: InboxNotice) => [n.id, n])).values()] } : d);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load more');
    } };
    const archive=async(id:string)=>{setLoading(true);try{const r=await apiFetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:archived?'restore':'archive',id})});const d=await r.json() as any;if(!r.ok)throw new Error(d.error);await reload()}catch(e){setError(e instanceof Error?e.message:'Unable to archive');setLoading(false)}};
    return <Inbox.Provider value={{ data, error, loading, guest, reload, read, more,archived,setArchived,archive }}>{children}</Inbox.Provider>;
}
function useInbox() { const c = useContext(Inbox); if (!c)
    throw new Error('NotificationProvider required'); return c; }
export function HomeNotificationPreview(){
 const {data,error,loading,archived}=useInbox(),{t,prefs}=useOrin(),{navigate}=useNavigation();
 const notice=archived?null:data?.items.find(n=>!n.read_at)??data?.items[0];
 return <button className={'orin-home-notice'+(notice&&!notice.read_at?' unread':'')} onClick={()=>navigate(notice?'/notifications/'+encodeURIComponent(notice.id):'/notifications')}>
  <span className="orin-home-notice-icon"><img src="/brand/orin-mark.png" alt=""/></span>
  <span className="orin-home-notice-copy"><span className="orin-home-notice-meta"><b>ORIN</b>{notice&&<time dateTime={new Date(notice.created_at).toISOString()}>{new Intl.DateTimeFormat(prefs.chartLocale+'-u-nu-latn',{month:'short',day:'numeric',timeZone:prefs.timezone}).format(notice.created_at)}</time>}</span>
  <strong>{notice?.title??(error?t('تعذر تحديث الإشعارات','Notifications unavailable'):loading||archived?t('مركز الإشعارات','Notification center'):t('أنت مطّلع على آخر التحديثات','You’re all caught up'))}</strong><span>{notice?.message??t('افتح مركز الإشعارات لمتابعة تحديثات حسابك.','Open your notification center for account updates.')}</span></span><span className="notice-chevron" aria-hidden="true">›</span>
 </button>;
}
export function NotificationBadgeBridge() {
    const { data } = useInbox();
    const count = Number(data?.unreadCount || 0);
    const { t } = useOrin();
    useEffect(() => {
        type Badger = Navigator & {
            setAppBadge?: (v: number) => Promise<void>;
            clearAppBadge?: () => Promise<void>;
        };
        const n = navigator as Badger;
        if (data) {
            void (count > 0 ? n.setAppBadge?.(count) : n.clearAppBadge?.())?.catch(() => {});
        }
    }, [count, data]);
    if (!count || count <= 0) return null;
    return <span className="notification-count" aria-label={t(`${count} إشعار غير مقروء`, `${count} unread notifications`)}>{count > 99 ? '99+' : count}</span>;
}
export function NotificationCenter() {
    const { path, navigate, back } = useNavigation(), { t, prefs } = useOrin(), { data, error, loading, guest, reload, read, more,archived,setArchived } = useInbox();
    const [filter, setFilter] = useState<NoticeFilter>('all'),[loadingMore,setLoadingMore]=useState(false);
    const opened = path === '/notifications' || path.startsWith('/announcements/') || path.startsWith('/notifications/');
    const detailId = path === '/notifications' ? null : decodeURIComponent(path.split('/').slice(2).join('/'));
    const [detail, setDetail] = useState<InboxNotice | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(''), [detailRetry, setDetailRetry] = useState(0);
    useEffect(() => { setDetail(null); setDetailError(''); if (!detailId || guest)
        return; let active = true; setDetailLoading(true); void (async () => { try {
        const r = await apiFetch('/api/notifications?id=' + encodeURIComponent(detailId), { cache: 'no-store' }), d = await r.json() as InboxState & {
            error?: string;
        };
        if (!r.ok)
            throw new Error(d.error);
        if (active)
            setDetail(d.items[0] ?? null);
        if (d.items[0] && !d.items[0].read_at) {
            await apiFetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: detailId }) });
            if (active)
                void reload();
        }
    }
    catch (e) {
        if (active)
            setDetailError(e instanceof Error ? e.message : 'Unable to load notification');
    }
    finally {
        if (active)
            setDetailLoading(false);
    } })(); return () => { active = false; }; }, [detailId, guest, reload, detailRetry]);
    useEffect(()=>{
        if(opened&&archived)setArchived(false);
        if(opened&&data&&Number(data.unreadCount||0)>0){void read();}
    },[opened,archived,setArchived,data?.unreadCount,read]);
    const openNotice=(n:InboxNotice)=>{navigate(n.deep_link==='/notifications'?'/notifications/'+encodeURIComponent(n.id):n.deep_link);if(!n.read_at)void read(n.id)};
    const loadMore=async()=>{if(loadingMore)return;setLoadingMore(true);try{await more()}finally{setLoadingMore(false)}};
    const format = (at: number) => new Intl.DateTimeFormat(prefs.chartLocale+'-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: prefs.timezone }).format(at);
    return <FullPage open={opened} onOpenChange={v => { if (!v)
        back('/'); }}><FullPageContent closeButton pageClassName="orin-notification-screen" navTitle={<span className="notification-brand"><img src="/brand/orin-mark.png" alt="" width="40" height="40"/><b>ORIN</b></span>}><FullPageHeader><FullPageTitle>{t('جميع الإشعارات', 'All notifications')}</FullPageTitle><FullPageDescription>{t('تحديثات حسابك في مكان واحد.', 'Your account updates, together.')}</FullPageDescription></FullPageHeader>
 {loading || detailLoading ? <div className="orin-empty" role="status"><span className="orin-loader"/>{t('جار تحميل الإشعارات', 'Loading notifications')}</div> : guest ? <div className="orin-empty"><ShieldCheck /><h2>{t('سجّل الدخول لعرض إشعاراتك', 'Sign in to see your notifications')}</h2><a className="btn-primary" target="_top" href={signInUrl(path)}>{t('تسجيل الدخول', 'Sign in')}</a></div> : error || detailError ? <div className="orin-page-error" role="alert"><strong>{t('تعذر الاتصال', 'Unable to connect')}</strong><p>{error || detailError}</p><button className="btn-outline" onClick={() => { void reload(); setDetailRetry(n => n + 1); }}><RefreshCw size={16}/>{t('إعادة المحاولة', 'Retry')}</button></div> : detailId ? <>{detail ? <article className="orin-campaign-preview"><h2>{displayText(detail.title??'')}</h2><time>{format(detail.created_at)}</time>{detail.image && <img src={detail.image} alt=""/>}<p style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>{displayText(detail.message??'')}</p><button className="btn-outline" onClick={() => navigate('/notifications')}>{t('كل الإشعارات', 'All notifications')}</button></article> : <div className="orin-empty"><Bell /><h2>{t('الإشعار غير متاح', 'Notification unavailable')}</h2><p>{t('قد يكون انتهت صلاحيته أو غير متاح لهذا الحساب.', 'It may have expired or be unavailable to this account.')}</p></div>}</> : <>
 <NotificationList items={data?.items??[]} total={data?.total??0} filter={filter} onFilter={setFilter} onOpen={openNotice} onMore={()=>void loadMore()} loadingMore={loadingMore}/>

 </>}
 </FullPageContent></FullPage>;
}

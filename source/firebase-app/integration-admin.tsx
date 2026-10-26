import React, { useCallback, useEffect, useRef, useState } from 'react';

type Props = { read: (path: string, options?: RequestInit) => Promise<any>; preview?: boolean };
type KeyRow = { id: string; label: string; scopes: string[]; expires_at: string; revoked_at: string | null };
const SCOPE_LABELS: Record<string, string> = {
  'account:read': 'الحساب الذي يملك العميل جلسة موثقة له',
  'balance:read': 'أرصدة الحساب نفسه',
  'transactions:read': 'عمليات العميل نفسه',
  'kyc:status': 'حالة التوثيق فقط (دون وثائق)',
  'policy:read': 'السياسة المالية النشطة'
};
const MESSAGES: Record<string, string> = {
  recent_sign_in_required: 'أعد تسجيل الدخول ثم كرّر الإجراء؛ إنشاء المفاتيح وإلغاؤها يتطلبان مصادقة حديثة.',
  staff_permission_required: 'يلزم موظف نشط بصلاحيتي إدارة الإعدادات والموظفين، وجلسة صالحة بعد آخر تحديث للصلاحيات.',
  integration_disabled: 'واجهة التكامل معطّلة. يلزم إعداد الخادم وتطبيق الترحيل قبل تفعيلها.',
  integration_unavailable: 'الخدمة غير متاحة. تحقق من إعداد الخادم والترحيل والصلاحيات.',
  verified_session_required: 'يلزم تسجيل الدخول بحساب ORIN موثّق.',
  invalid_key_request: 'تحقق من الاسم وتاريخ انتهاء الصلاحية (خلال 90 يومًا).',
  account_scope_required: 'عرض الأرصدة أو حالة التوثيق يتطلب إضافة صلاحية قراءة الحساب.',
  rate_limited: 'طلبات كثيرة. انتظر دقيقة ثم أعد المحاولة.'
};

/** No key is embedded in this client or saved to local/session storage. A newly
 * created secret is shown once, in this authorized admin view's memory only. */
export function IntegrationAdmin({ read, preview = false }: Props) {
  const [status, setStatus] = useState<any>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(30);
  const [scopes, setScopes] = useState<string[]>(['account:read', 'transactions:read']);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  const friendly = (e: unknown) => MESSAGES[(e as Error).message] || 'تعذّر إتمام الطلب. راجع إعداد الخدمة أو أعد تسجيل الدخول.';
  const load = useCallback(async () => {
    if (preview) return;
    try {
      const next = await read('/api/integration-admin/status');
      if (!alive.current) return;
      setStatus(next);
      if (next.enabled) {
        const result = await read('/api/integration-admin/keys');
        if (alive.current) setKeys(result.keys || []);
      } else setKeys([]);
    } catch (e) { if (alive.current) setError(friendly(e)); }
  }, [read, preview]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!secret) return;
    const hide = () => setSecret('');
    if (document.hidden) { hide(); return; }
    const timer = setTimeout(hide, 60000);
    const onVisibility = () => { if (document.hidden) hide(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [secret]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (preview || locked.current || !status?.enabled || !label.trim() || !scopes.length) return;
    if (!window.confirm('إنشاء مفتاح قراءة جديد؟ لا يثبت المفتاح ملكية حساب العميل ولا يربط Vino تلقائيًا. احفظه في أسرار الخادم فقط.')) return;
    locked.current = true; setBusy(true); setError(''); setSecret(''); setNotice('');
    try {
      const result = await read('/api/integration-admin/keys', { method: 'POST', body: JSON.stringify({ label: label.trim(), scopes, expiresAt: new Date(Date.now() + days * 86400000).toISOString() }) });
      if (!alive.current) return;
      setSecret(result.secret); setLabel(''); setNotice('تم إنشاء المفتاح. يظهر مرة واحدة، ويُخفى تلقائيًا بعد دقيقة أو عند مغادرة هذه الصفحة.');
      await load();
    } catch (e) { if (alive.current) setError(friendly(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function revoke(key: KeyRow) {
    if (preview || locked.current || !window.confirm(`إلغاء المفتاح «${key.label}»؟ ستُرفض الطلبات الجديدة التي تستخدمه.`)) return;
    locked.current = true; setBusy(true); setError(''); setSecret('');
    try {
      await read(`/api/integration-admin/keys/${encodeURIComponent(key.id)}/revoke`, { method: 'POST' });
      if (alive.current) { setNotice('تم إلغاء المفتاح.'); await load(); }
    } catch (e) { if (alive.current) setError(friendly(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="occ-panel" aria-labelledby="integration-title">
    <div className="occ-panel-heading"><h2 id="integration-title">واجهة التكامل الخارجي — قراءة فقط</h2><span className="occ-status">{preview ? 'معاينة دون عمليات' : status?.enabled ? 'مفعّلة على الخادم' : 'غير مفعّلة'}</span></div>
    <p>مفاتيح للخوادم الموثوقة مثل خادم Vino بعد إعداد ربط الهوية. المفتاح وحده لا يتيح بيانات المستخدمين: كل استعلام عميل يتطلب جلسة ORIN موثّقة تخص صاحب السجل. البريد ورقم الحساب ورقم العملية وسائل بحث، وليست إثبات ملكية.</p>
    <p className="occ-muted">لم يُنفّذ اتصال Vino الخارجي في هذه الحزمة. لا تضع المفتاح في APK أو كود العميل أو المحادثة. لا تُعرض كلمات مرور أو رموز تحقق أو وثائق هوية. لا توجد صلاحيات تعديل أموال أو تداول.</p>
    {error && <p role="alert" className="occ-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {secret && <div role="status"><strong>المفتاح الجديد — عرض واحد</strong><pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'all' }}>{secret}</pre><button type="button" onClick={() => setSecret('')}>إخفاء الآن</button><p className="occ-muted">إذا فُقد المفتاح، ألغِه وأنشئ بديلًا. لا يمكن استرجاعه من الخادم.</p></div>}
    {!status?.enabled && !preview && <p>متطلبات الخادم: الترحيل 029، معرّف نطاق التكامل، سر التدقيق، ثم تفعيل التكامل صراحة. تفعيل الواجهة لا يثبت إعداد الربط الخارجي.</p>}
    <form onSubmit={event => void create(event)}>
      <div className="occ-form-grid">
        <label>اسم التكامل<input maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="خادم دعم خارجي" disabled={busy || preview || !status?.enabled}/></label>
        <label>الصلاحية بالأيام<input type="number" min={1} max={89} value={days} onChange={event => setDays(Math.min(89, Math.max(1, Number(event.target.value) || 1)))} disabled={busy || preview || !status?.enabled}/></label>
        <fieldset disabled={busy || preview || !status?.enabled}><legend>القراءة المسموح بها</legend>{Object.entries(SCOPE_LABELS).map(([scope, title]) => <label key={scope} style={{ display: 'block' }}><input type="checkbox" checked={scopes.includes(scope)} onChange={event => setScopes(old => event.target.checked ? [...old, scope] : old.filter(value => value !== scope))}/>{title}</label>)}</fieldset>
      </div>
      <button className="occ-primary" disabled={busy || preview || !status?.enabled || !label.trim() || !scopes.length}>إنشاء مفتاح وعرضه مرة واحدة</button>
      <button type="button" disabled={busy || preview} onClick={() => { setError(''); void load(); }}>تحديث الحالة</button>
    </form>
    {keys.length > 0 && <div className="occ-table-scroll"><table><thead><tr><th>الاسم</th><th>الصلاحيات</th><th>انتهاء الصلاحية</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{keys.map(key => <tr key={key.id}><td>{key.label}</td><td>{key.scopes.map(scope => SCOPE_LABELS[scope] || scope).join(' · ')}</td><td><bdi>{new Date(key.expires_at).toLocaleString('en-GB')}</bdi></td><td>{key.revoked_at ? 'ملغى' : Date.parse(key.expires_at) <= Date.now() ? 'منتهي' : 'نشط'}</td><td><button type="button" disabled={busy || !!key.revoked_at} onClick={() => void revoke(key)}>إلغاء</button></td></tr>)}</tbody></table></div>}
  </section>;
}

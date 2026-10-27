'use client';
import {LanguageSettings} from './language-settings';
import {LANGUAGES} from '@/lib/locales';
import {SecurityCenter} from './security-center';
import { signOutUrl } from '@/lib/client-api';
import { type ReactNode } from 'react';
import { Bell, Check, ChevronLeft, ChartCandlestick, Download, EyeOff, FileText, Globe2, Info, LockKeyhole, ShieldCheck, SlidersHorizontal, UserRound, Wallet, ClipboardList, Palette, Sun, Moon, Monitor, ChevronRight, LogOut, RefreshCw, Headphones, Gift, BadgeCheck, Smartphone, Apple, ShieldAlert, ExternalLink, Sparkles } from 'lucide-react';
import { FullPage as Dialog, FullPageContent as DialogContent } from './full-page';
import { useRoutePanel, useNavigation } from './orin-navigation';
import { SoundPreferences } from './sound-preferences';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { LabState } from '@/lib/contracts';
import { NOTICE_EVENTS, type Preferences } from '@/lib/preferences';
import { MARKET_SYMBOLS } from '@/lib/market-symbols';
import { useOrin } from './orin-settings';
import { AdminChartSettings } from './admin-chart-settings';
import {DataControls} from './account-extras';
import {ProfileSettings} from './profile-settings';
import {KycModal} from './kyc-verification';
import {APP_VERSION} from '../lib/account-validation';
export function SettingsToggle({ value, onChange, label, disabled = false }: {
    value: boolean;
    onChange: (value: boolean) => void;
    label: string;
    disabled?: boolean;
}) { return <Switch checked={value} onCheckedChange={onChange} aria-label={label} className={`settings-switch ${value ? 'on' : ''}`} disabled={disabled}/>; }
export function SettingsRow({ icon, title, detail, children, onClick }: {
    icon: ReactNode;
    title: string;
    detail?: string;
    children?: ReactNode;
    onClick?: () => void;
}) { 
    const { prefs } = useOrin(); 
    const Chevron = prefs.chartLocale === 'ar' ? ChevronLeft : ChevronRight;
    const content = <>
        <span className="setting-icon">{icon}</span>
        <span className="setting-copy">
            <b>{title}</b>
            {detail && Boolean(children) && <small>{detail}</small>}
        </span>
        <div className="setting-end">
            {detail && !children && <span className="setting-val">{detail}</span>}
            {children ?? <Chevron size={18} className="setting-chevron"/>}
        </div>
    </>; 
    return onClick ? <button type="button" className="settings-row settings-modern-row" onClick={onClick}>{content}</button> : <div className="settings-row settings-modern-row">{content}</div>; 
}
export function SettingsSelect({ value, label, items, onChange, disabled = false }: {
    value: string;
    label: string;
    items: (readonly [
        string,
        string
    ])[];
    onChange: (v: string) => void;
    disabled?: boolean;
}) { return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="settings-native-select" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{items.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}</SelectContent></Select>; }
const EVENT_NAMES: Record<string, [
    string,
    string
]> = { opportunity: ['فرصة جديدة', 'New opportunity'], contract_started: ['عقد بدأ', 'Contract started'], contract_ended: ['عقد انتهى', 'Contract ended'], settlement: ['نتيجة تسوية', 'Settlement result'], deposit: ['إيداع', 'Deposit'], withdrawal: ['سحب', 'Withdrawal'], referral: ['إحالة ناجحة', 'Successful referral'], agent: ['ترقية Agent', 'Agent upgrade'], support: ['الدعم', 'Support'], security: ['تنبيهات الأمان', 'Security alerts'], announcement: ['الإعلانات', 'Announcements'], reminder: ['التذكيرات', 'Reminders'] };
export const FRAME_NAMES: Record<string, string> = { '1': '1m', '5': '5m', '15': '15m', '60': '1h', '240': '4h', 'D': '1D' };
export const INDICATOR_NAMES: Record<string, string> = { MA: 'Moving Average', EMA: 'EMA', RSI: 'RSI', MACD: 'MACD', BB: 'Bollinger Bands' };
export function ChartPreferences() {
    const { prefs, configuration: c, change, t, status } = useOrin();
    const busy = status === 'saving' || status === 'loading';
    return <><section className="settings-group">
 <SettingsRow icon={<ChartCandlestick />} title={t('نوع الشارت', 'Chart type')}><SettingsSelect label={t('نوع الشارت', 'Chart type')} value={prefs.chartStyle} items={c.enabledChartTypes.map(k => [k, k === '1' ? t('شموع', 'Candles') : k === '2' ? t('خطي', 'Line') : t('مساحة', 'Area')])} disabled={busy} onChange={v => void change({ chartStyle: v as Preferences['chartStyle'] })}/></SettingsRow>
 <SettingsRow icon={<Globe2 />} title={t('الأصل الافتراضي', 'Default symbol')}><SettingsSelect label={t('الأصل الافتراضي', 'Default symbol')} value={prefs.chartPair} items={MARKET_SYMBOLS.filter(s => c.enabledSymbols.includes(s.pair)).map(s => [s.pair, s.label])} disabled={busy} onChange={v => void change({ chartPair: v })}/></SettingsRow>
 <SettingsRow icon={<SlidersHorizontal />} title={t('الفاصل الزمني', 'Default timeframe')}><SettingsSelect label={t('الفاصل الزمني', 'Default timeframe')} value={prefs.chartInterval} items={c.enabledTimeframes.map(k => [k, FRAME_NAMES[k]])} disabled={busy} onChange={v => void change({ chartInterval: v as Preferences['chartInterval'] })}/></SettingsRow>
 <SettingsRow icon={<Palette />} title={t('مظهر الشارت', 'Chart theme')} detail={t('يتبع مظهر ORIN', 'Follows ORIN appearance')}><span className="quiet-badge">{prefs.theme === 'system' ? t('النظام', 'System') : prefs.theme === 'dark' ? t('داكن', 'Dark') : t('فاتح', 'Light')}</span></SettingsRow>
 <SettingsRow icon={<SlidersHorizontal />} title={t('خطوط الشبكة', 'Grid')}><SettingsToggle label="Grid" value={prefs.grid} disabled={busy} onChange={v => void change({ grid: v })}/></SettingsRow>
 </section><h3 className="settings-section-label">{t('المؤشرات المسموحة', 'Allowed indicators')}</h3><div className="option-chips">{c.allowedIndicators.map(k => <button key={k} disabled={busy} aria-pressed={prefs.indicators.includes(k)} className={prefs.indicators.includes(k) ? 'selected' : ''} onClick={() => void change({ indicators: prefs.indicators.includes(k) ? prefs.indicators.filter(x => x !== k) : [...prefs.indicators, k] })}>{prefs.indicators.includes(k) && <Check size={14}/>} {INDICATOR_NAMES[k]}</button>)}{!c.allowedIndicators.length && <p>{t('لا توجد مؤشرات مفعلة من الإدارة.', 'No indicators enabled by the administrator.')}</p>}</div>
 <button className="btn-outline full settings-reset" disabled={busy} onClick={() => void change({ chartPair: c.defaultSymbol, chartInterval: c.defaultTimeframe as Preferences['chartInterval'], chartStyle: c.defaultChartType as Preferences['chartStyle'], grid: c.gridDefault, indicators: [] })}><RefreshCw size={16}/>{t('إعادة تعيين الشارت', 'Reset chart')}</button><p className="settings-footnote">{t('تُطبّق الخيارات التي يسمح بها تكامل TradingView. يظل شعار المصدر ظاهرًا.', 'Only supported TradingView options are applied. Provider attribution remains visible.')}</p></>;
}
export function AppearanceSettings(){
 const {prefs,t,change,status}=useOrin();
 const busy=status==='saving'||status==='loading';
 return <div className="settings-group settings-appearance-options" role="group" aria-label={t('المظهر','Appearance')}>
  {([['light',Sun,t('فاتح','Light')],['dark',Moon,t('داكن','Dark')],['system',Monitor,t('حسب النظام','System')]] as const).map(([value,Icon,label])=><button type="button" className="settings-row" key={value} aria-pressed={prefs.theme===value} disabled={busy} onClick={()=>void change({theme:value})}><span className="setting-icon"><Icon/></span><span className="setting-copy"><b>{label}</b></span><span className={'settings-choice'+(prefs.theme===value?' is-selected':'')} aria-hidden="true"/></button>)}
 </div>;
}
function AppPreferences(){
 const {prefs,t,change,status}=useOrin();
 const busy=status==='saving'||status==='loading';
 return <section className="settings-group">
  <SettingsRow icon={<Palette/>} title={t('حجم الخط','Font size')}><SettingsSelect value={prefs.fontSize} label={t('حجم الخط','Font size')} items={[["small",t('صغير','Small')],["normal",t('متوسط','Default')],["large",t('كبير','Large')]]} disabled={busy} onChange={v=>void change({fontSize:v as Preferences['fontSize']})}/></SettingsRow>
  <SettingsRow icon={<SlidersHorizontal/>} title={t('تنسيق الأرقام','Number format')} detail={t('أرقام إنجليزية في جميع اللغات','Latin digits in all languages')}><span className="num">1,234.56</span></SettingsRow>
  <SettingsRow icon={<Wallet/>} title={t('العملة المرجعية','Reference currency')} detail={t('تفضيل محفوظ؛ الأرصدة والتسوية تبقى USD حتى توصيل تحويل العملات.','Saved preference; balances and settlement remain USD until FX conversion is connected.')}><SettingsSelect value={prefs.referenceCurrency} label={t('العملة المرجعية','Reference currency')} items={[["USD","USD"],["EUR","EUR"],["GBP","GBP"]]} disabled={busy} onChange={v=>void change({referenceCurrency:v as Preferences['referenceCurrency']})}/></SettingsRow>
  <SettingsRow icon={<Globe2/>} title={t('المنطقة الزمنية','Time zone')}><SettingsSelect value={prefs.timezone} label={t('المنطقة الزمنية','Time zone')} items={Array.from(new Set([prefs.timezone,'Etc/UTC',Intl.DateTimeFormat().resolvedOptions().timeZone,'Asia/Damascus','Asia/Riyadh','Asia/Dubai','Europe/Istanbul','Europe/Berlin','Europe/Vienna','Europe/Zurich','Europe/London','Europe/Paris','America/New_York','Asia/Tokyo'])).map(v=>[v,v.replaceAll('_',' ')])} disabled={busy} onChange={v=>void change({timezone:v})}/></SettingsRow>
  <SettingsRow icon={<Monitor/>} title={t('تقليل الحركة','Reduce motion')}><SettingsToggle label={t('تقليل الحركة','Reduce motion')} value={prefs.reduceMotion} disabled={busy} onChange={v=>void change({reduceMotion:v})}/></SettingsRow>
 </section>;
}
export function AccountSettings({ state, onTerms, onAdmin, onLedger, onNotifications }: {
    state: LabState | null;
    prefs: Preferences;
    onChange: (value: Partial<Preferences>) => void;
    onTerms: () => void;
    onAdmin: () => void;
    onLedger: () => void;
    onNotifications: () => void;
}) {
    const { prefs, settings, status, error, t, change, reload } = useOrin();
    const [panel, setPanel] = useRoutePanel('/settings', ['account', 'appearance', 'security', 'notifications', 'chart', 'about', 'admin', 'language', 'devices', 'privacy', 'documents', 'support', 'referral', 'agent', 'two-factor', 'authenticator', 'data', 'kyc', 'app', 'accounts', 'preferences', 'reports', 'programs'] as const);
    const navigation = useNavigation();
    const busy = status === 'saving' || status === 'loading';
    const titles = { account: t('الملف الشخصي', 'Your profile'), appearance: t('المظهر', 'Appearance'), security: t('مركز الأمان', 'Security center'), notifications: t('تفضيلات الإشعارات', 'Notification preferences'), chart: t('إعدادات الشارت', 'Chart settings'), about: t('حول ORIN', 'About ORIN'), admin: t('إدارة إعدادات الشارت', 'Admin chart settings'), language: t('اللغة', 'Language'), devices: t('الأجهزة', 'Devices'), privacy: t('الخصوصية', 'Privacy'), documents: t('المستندات', 'Documents'), support: t('الدعم', 'Support'), referral: t('مركز الإحالات', 'Referral center'), agent: t('مركز الوكلاء', 'Agent center'), 'two-factor': t('المصادقة الثنائية', 'Two-factor authentication'), data:t('البيانات والخصوصية','Data & privacy'), authenticator: t('تطبيق المصادقة', 'Authenticator setup'), kyc: t('توثيق الهوية (KYC)', 'Identity verification (KYC)'), app: t('تطبيق الجوال', 'Mobile app'), accounts:t('الحسابات والمعاملات','Accounts & transactions'), preferences:t('إعدادات التطبيق','App settings'), reports:t('البيانات والتقارير','Data & reports'), programs:t('برامج ORIN','ORIN programs') };
    const syncText = status === 'saving' ? t('جار الحفظ…', 'Saving…') : status === 'loading' ? t('جار المزامنة…', 'Syncing…') : status === 'synced' ? t('متزامن مع حسابك', 'Synced to your account') : status === 'guest' ? t('تفضيلات هذا الجهاز · سجّل الدخول للمزامنة', 'This device only · Sign in to sync') : t('تعذرت المزامنة', 'Sync unavailable');

    const themeLabel = prefs.theme === 'dark' ? t('داكن', 'Dark') : prefs.theme === 'light' ? t('فاتح', 'Light') : t('تلقائي', 'Auto');
    const langLabel = LANGUAGES.find(l => l.code === prefs.chartLocale)?.native || (prefs.chartLocale === 'ar' ? 'العربية' : 'English');

    return <div className="settings-page settings-refresh settings-modern-view" dir={prefs.chartLocale === 'ar' ? 'rtl' : 'ltr'}>
  <header className="settings-heading"><h1>{t('الإعدادات','Settings')}</h1></header>
  
  {/* Group 1: الحساب والأمان */}
  <h2 className="settings-section-label">{t('الحساب والأمان','Account & security')}</h2>
  <section className="settings-group">
   <SettingsRow icon={<UserRound size={22} strokeWidth={1.75} />} title={t('بيانات الحساب','Account details')} onClick={()=>setPanel('account')}/>
   <SettingsRow icon={<ShieldCheck size={22} strokeWidth={1.75} />} title={t('الأمان','Security')} onClick={()=>setPanel('security')}/>
   <SettingsRow icon={<LockKeyhole size={22} strokeWidth={1.75} />} title={t('الخصوصية والبيانات','Privacy & data')} onClick={()=>setPanel('data')}/>
   <SettingsRow icon={<Bell size={22} strokeWidth={1.75} />} title={t('الإشعارات','Notifications')} onClick={()=>setPanel('notifications')}/>
  </section>

  {/* Group 2: التطبيق والمظهر */}
  <h2 className="settings-section-label">{t('التطبيق والمظهر','App & appearance')}</h2>
  <section className="settings-group">
   <SettingsRow icon={<Moon size={22} strokeWidth={1.75} />} title={t('المظهر','Appearance')} detail={themeLabel} onClick={()=>setPanel('appearance')}/>
   <SettingsRow icon={<Globe2 size={22} strokeWidth={1.75} />} title={t('اللغة','Language')} detail={langLabel} onClick={()=>setPanel('language')}/>
   <SettingsRow icon={<Smartphone size={22} strokeWidth={1.75} />} title={t('إعدادات التطبيق','App settings')} onClick={()=>setPanel('preferences')}/>
  </section>

  {/* Group 3: المعاملات والخدمات */}
  <h2 className="settings-section-label">{t('المعاملات والخدمات','Transactions & services')}</h2>
  <section className="settings-group">
   <SettingsRow icon={<FileText size={22} strokeWidth={1.75} />} title={t('المعاملات الأخيرة','Recent transactions')} onClick={()=>navigation.navigate('/activity')}/>
   <SettingsRow icon={<Headphones size={22} strokeWidth={1.75} />} title={t('الدعم والمساعدة','Help & support')} onClick={()=>navigation.navigate('/support')}/>
  </section>

  {Boolean(state?.isAdmin || settings?.controlAvailable)&&<section className="settings-group" style={{marginTop: 16}}><SettingsRow icon={<ShieldCheck size={22} strokeWidth={1.75} />} title={t('مركز إدارة ORIN','ORIN Control Center')} detail={t('إدارة العملاء والصلاحيات والعمليات','Customers, permissions and operations')} onClick={()=>navigation.navigate('/admin')}/></section>}
  {state?.isAdmin&&<><h2 className="settings-section-label">{t('مساحة الإدارة','Administration')}</h2><section className="settings-group"><SettingsRow icon={<UserRound size={22} strokeWidth={1.75} />} title={t('إدارة المستخدمين','User management')} onClick={()=>navigation.navigate('/admin/users')}/><SettingsRow icon={<Wallet size={22} strokeWidth={1.75} />} title={t('المكافآت والبونص والوكالة','Rewards, bonus & agency')} onClick={()=>navigation.navigate('/admin/programs')}/><SettingsRow icon={<ClipboardList size={22} strokeWidth={1.75} />} title={t('العقود والدعوات','Contracts & invitations')} onClick={onAdmin}/><SettingsRow icon={<SlidersHorizontal size={22} strokeWidth={1.75} />} title={t('إعدادات الأسواق','Market settings')} onClick={()=>setPanel('admin')}/><SettingsRow icon={<Bell size={22} strokeWidth={1.75} />} title={t('إدارة الإشعارات','Notification administration')} onClick={()=>navigation.navigate('/admin/notifications')}/></section></>}
  <div className={`settings-sync ${status}`} role="status"><span/>{syncText}{status==='error'&&<button type="button" onClick={()=>void reload()} aria-label={t('إعادة المزامنة','Retry sync')}><RefreshCw size={15}/></button>}</div>
  {error&&<p className="settings-error" role="alert">{error}</p>}
  {settings&&<a className="settings-row settings-signout" href={signOutUrl()} style={{marginTop: 12}}><LogOut size={20} /><strong>{t('تسجيل الخروج','Sign out')}</strong></a>}
  <Dialog open={panel !== null} onOpenChange={open=>{if(!open)setPanel(null)}}><DialogContent pageClassName={'orin-settings-screen settings-compact'+(panel==='account'?' orin-profile-screen':'')} navTitle={<strong>{panel&&titles[panel]}</strong>} className={`popup settings-dialog ${panel==='admin'?'admin-settings-dialog':''}`} dir={prefs.chartLocale==='ar'?'rtl':'ltr'}>
  {panel==='preferences'&&<><AppPreferences/><section className="settings-group"><SettingsRow icon={<Globe2/>} title={t('لغة التطبيق','App language')} detail={LANGUAGES.find(language=>language.code===prefs.chartLocale)?.native} onClick={()=>setPanel('language')}/><SettingsRow icon={<Smartphone/>} title={t('تطبيق الجوال','Mobile app')} detail={t('أندرويد APK و iOS','Android APK & iOS')} onClick={()=>setPanel('app')}/></section></>}
  {panel==='accounts'&&<section className="settings-group">
   <SettingsRow icon={<Wallet/>} title={t('الحسابات','Accounts')} detail={t('اختيار الحساب أو إنشاؤه من بطاقة الرصيد','Select or create an account from the balance card')} onClick={()=>navigation.navigate('/')}/>
   <SettingsRow icon={<ClipboardList/>} title={t('المراكز والمعاملات الأخيرة','Positions & recent transactions')} onClick={()=>navigation.navigate('/positions')}/>
   <SettingsRow icon={<ClipboardList/>} title={t('جميع المعاملات','All transactions')} onClick={()=>navigation.navigate('/activity')}/>
   <SettingsRow icon={<BadgeCheck/>} title={t('توثيق الهوية (KYC)','Identity verification (KYC)')} onClick={()=>setPanel('kyc')}/>
   <SettingsRow icon={<EyeOff/>} title={t('إخفاء الأرصدة','Hide balances')}><SettingsToggle label={t('إخفاء الأرصدة','Hide balances')} value={prefs.hideBalance} disabled={busy} onChange={hideBalance=>void change({hideBalance})}/></SettingsRow>
   <SettingsRow icon={<Gift/>} title={t('برامج ORIN','ORIN programs')} onClick={()=>setPanel('programs')}/>
  </section>}
  {panel==='reports'&&<section className="settings-group"><SettingsRow icon={<Download/>} title={t('كشف حركات الحساب','Account statement')} detail="PDF" onClick={onLedger}/><SettingsRow icon={<ClipboardList/>} title={t('المستندات','Documents')} onClick={()=>navigation.navigate('/documents')}/><SettingsRow icon={<LockKeyhole/>} title={t('بياناتي وخصوصيتي','My data & privacy')} onClick={()=>setPanel('data')}/></section>}
  {panel==='programs'&&<section className="settings-group">
   <SettingsRow icon={<Gift/>} title={t('دعوة صديق','Referral program')} onClick={()=>navigation.navigate('/referral')}/>
   <SettingsRow icon={<Globe2/>} title={t('شجرة الإحالات','Referral tree')} onClick={()=>navigation.navigate('/referral/tree')}/>
   <SettingsRow icon={<BadgeCheck/>} title={t('الشارات والإنجازات','Badges & achievements')} onClick={()=>navigation.navigate('/badges')}/>
   <SettingsRow icon={<Wallet/>} title={t('بونص الترحيب $100','Welcome bonus $100')} onClick={()=>navigation.navigate('/bonus')}/>
   <SettingsRow icon={<UserRound/>} title={t('برنامج الوكالة','Agency program')} onClick={()=>navigation.navigate('/agent')}/>
  </section>}
  {panel === 'account' && <ProfileSettings state={state} onSecurity={()=>setPanel('security')} onPrivacy={()=>setPanel('data')}/>}
  {panel === 'kyc' && <KycModal standalone onClose={()=>setPanel(null)} onSuccess={()=>setPanel(null)}/>}
  {panel === 'language' && <LanguageSettings compact/>}
  {panel === 'appearance' && <AppearanceSettings/>}
  {panel==='data'&&<DataControls/>}{panel === 'chart' && <ChartPreferences />}
  {panel === 'notifications' && <><SoundPreferences /><section className="settings-group"><SettingsRow icon={<Bell />} title={t('تنبيهات داخل التطبيق', 'In-app notifications')}><SettingsToggle label="In-app notifications" value={prefs.notifications} disabled={busy} onChange={v => void change({ notifications: v })}/></SettingsRow><SettingsRow icon={<Bell />} title={t('مركز الإشعارات', 'Notification center')} onClick={() => { setPanel(null); onNotifications(); }}/></section><h3 className="settings-section-label">{t('الأحداث', 'Events')}</h3><section className="settings-group">{NOTICE_EVENTS.map(k => <SettingsRow key={k} icon={k === 'security' ? <ShieldAlert /> : <Bell />} title={t(...EVENT_NAMES[k])} detail={['opportunity', 'contract_started', 'contract_ended', 'settlement'].includes(k) ? undefined : t('تفضيل محفوظ للخدمة عند تفعيلها', 'Preference saved for when this service is connected')}><SettingsToggle label={EVENT_NAMES[k][1]} value={prefs.notificationEvents[k]} disabled={busy || k === 'security'} onChange={v => void change({ notificationEvents: { ...prefs.notificationEvents, [k]: v } })}/></SettingsRow>)}</section></>}
  {panel === 'security' && <SecurityCenter t={t} onPassword={()=>navigation.navigate('/account/security')}/>}
  {panel === 'two-factor' && <SecurityCenter t={t} initialPanel="totp"/>}{panel === 'authenticator' && <SecurityCenter t={t} initialPanel="totp"/>}{panel === 'devices' && <SecurityCenter t={t} initialPanel="sessions"/>}{panel === 'admin' && <AdminChartSettings />}
  {panel === 'about' && <div className="about-data"><h2>ORIN {APP_VERSION}</h2><a href="/privacy">{t('سياسة الخصوصية','Privacy policy')}</a><img src="/brand/orin-mark.png" alt="ORIN"/><p>{t('الشارت يستخدم Coinbase Exchange لشموع BTC/USD وTradingView للأصول الأخرى. قد تختلف درجة التأخير بحسب المصدر والسوق.', 'BTC/USD candles use Coinbase Exchange; other assets use TradingView. Delays vary by source and market.')}</p><p>{t('العقود الداخلية مستقلة عن السوق. تظهر نسبة التسوية المقفلة قبل المشاركة، ولا تمثل تنفيذًا لأمر في بورصة.', 'Internal contracts are independent of the market. Locked settlement terms are shown before participation and do not represent an exchange execution.')}</p><p>{t('تكامل Widget الحالي لا يتيح وقت آخر سعر لـ ORIN، أو حفظ الرسومات، أو تنبيهات أسعار خلفية. تغيير الرمز أو الفاصل يعيد تهيئة الشارت.', 'The current widget does not expose the last quote time, drawing storage or background price alerts to ORIN. Changing symbol or interval reinitializes the chart.')}</p><a href="https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/" target="_blank" rel="noopener noreferrer">TradingView <ExternalLink size={14}/></a></div>}
  {panel === 'app' && (
    <div className="about-data settings-app-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2>{t('تطبيقات ORIN الرسمية', 'Official ORIN Mobile Apps')}</h2>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--orin-muted)', lineHeight: '1.6' }}>
        {t('تداول فوري وأسعار حية مستقرة مع تحديثات تلقائية وتجربة سلسة على هاتفك.', 'Instant trading, live quotes, and seamless performance on your mobile phone.')}
      </p>
      <div style={{ padding: '16px', borderRadius: '16px', background: 'var(--orin-surface)', border: '1px solid var(--orin-line)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Smartphone size={22} style={{ color: '#20b792' }} />
            <div>
              <strong style={{ fontSize: '14px', display: 'block' }}>{t('تطبيق أندرويد (APK)', 'Android App (APK)')}</strong>
              <small style={{ color: 'var(--orin-muted)', fontSize: '11px' }}>v1.6.2 Live · 36.6 MB</small>
            </div>
          </div>
          <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: 'rgba(32, 183, 146, 0.15)', color: '#20b792' }}>
            {t('رسمي مباشر', 'Official')}
          </span>
        </div>
        <a
          href="/downloads/ORIN-Android-1.6.2.apk"
          download="ORIN-Android-1.6.2.apk"
          className="btn-primary"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '11px 16px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #20b792, #10ac89)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '13px'
          }}
        >
          <Download size={16} />
          <span>{t('تحميل ملف APK المباشر', 'Download APK Package')}</span>
        </a>
      </div>
      <div style={{ padding: '16px', borderRadius: '16px', background: 'var(--orin-surface)', border: '1px solid var(--orin-line)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Apple size={22} />
            <div>
              <strong style={{ fontSize: '14px', display: 'block' }}>{t('تطبيق آبل (Apple iOS)', 'Apple iOS App')}</strong>
              <small style={{ color: 'var(--orin-muted)', fontSize: '11px' }}>{t('شاشة كاملة / WebClip', 'Fullscreen WebClip')}</small>
            </div>
          </div>
          <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: 'rgba(7, 136, 255, 0.15)', color: '#0788ff' }}>
            iOS WebClip
          </span>
        </div>
        <a
          href="/orin.mobileconfig"
          download="orin.mobileconfig"
          className="btn-outline"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '11px 16px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '13px'
          }}
        >
          <Sparkles size={16} />
          <span>{t('تحميل ملف تعريف iOS (.mobileconfig)', 'Install iOS Profile')}</span>
        </a>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--orin-muted)', lineHeight: '1.5' }}>
          {t('أو اضغط زر المشاركة (Share) في متصفح Safari ثم اختر "إضافة إلى الشاشة الرئيسية" لإضافة أيقونة التطبيق مباشرة.', 'Or tap Share in Safari and select "Add to Home Screen" to install instantly.')}
        </p>
      </div>
    </div>
  )}
  <p className="settings-panel-status" role="status">{syncText}</p>
  {error&&<p className="settings-error" role="alert">{error}</p>}
  </DialogContent></Dialog>
 </div>;
}

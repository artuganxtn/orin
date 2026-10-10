'use client';
import {LanguageSettings} from './language-settings';
import {SecurityCenter} from './security-center';
import { firebaseMode, signInUrl, signOutUrl } from '@/lib/client-api';
import { useEffect, useState, type ReactNode } from 'react';
import { Bell, Check, ChevronLeft, ChartCandlestick, Download, EyeOff, Globe2, Info, LockKeyhole, ShieldCheck, SlidersHorizontal, UserRound, Wallet, ClipboardList, Copy, Palette, Sun, Moon, Monitor, ChevronRight, LogOut, RefreshCw, Headphones, Gift, BadgeCheck, KeyRound, Fingerprint, Smartphone, ShieldAlert, ExternalLink } from 'lucide-react';
import { FullPage as Dialog, FullPageContent as DialogContent, FullPageHeader as DialogHeader, FullPageTitle as DialogTitle, FullPageDescription as DialogDescription } from './full-page';
import { useRoutePanel, useNavigation } from './orin-navigation';
import { SoundPreferences } from './sound-preferences';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { LabState } from '@/lib/contracts';
import { NOTICE_EVENTS, type AccountProfile, type Preferences } from '@/lib/preferences';
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
}) { const { prefs } = useOrin(); const content = <><span className="setting-icon">{icon}</span><span className="setting-copy"><b>{title}</b>{detail && <small>{detail}</small>}</span>{children ?? (prefs.chartLocale === 'ar' ? <ChevronLeft className="setting-chevron"/> : <ChevronRight className="setting-chevron"/>)}</>; return onClick ? <button className="settings-row" onClick={onClick}>{content}</button> : <div className="settings-row">{content}</div>; }
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
 <SettingsRow icon={<Info />} title="Crosshair" detail={t('متاح داخل الشارت؛ التحكم به من المزود', 'Available in chart; managed by provider')}><SettingsToggle label="Crosshair" value disabled onChange={() => { }}/></SettingsRow>
 <SettingsRow icon={<Info />} title={t('خط السعر الحالي', 'Current price line')} detail={t('متاح داخل الشارت؛ التحكم به من المزود', 'Available in chart; managed by provider')}><SettingsToggle label="Price line" value disabled onChange={() => { }}/></SettingsRow>
 <SettingsRow icon={<LockKeyhole />} title={t('حفظ الرسومات', 'Save drawings')} detail={t('يتطلب تكاملًا يدعم Drawing API', 'Requires an integration with a drawing API')}><SettingsToggle label="Save drawings" value={false} disabled onChange={() => { }}/></SettingsRow>
 </section><h3 className="settings-section-label">{t('المؤشرات المسموحة', 'Allowed indicators')}</h3><div className="option-chips">{c.allowedIndicators.map(k => <button key={k} disabled={busy} aria-pressed={prefs.indicators.includes(k)} className={prefs.indicators.includes(k) ? 'selected' : ''} onClick={() => void change({ indicators: prefs.indicators.includes(k) ? prefs.indicators.filter(x => x !== k) : [...prefs.indicators, k] })}>{prefs.indicators.includes(k) && <Check size={14}/>} {INDICATOR_NAMES[k]}</button>)}{!c.allowedIndicators.length && <p>{t('لا توجد مؤشرات مفعلة من الإدارة.', 'No indicators enabled by the administrator.')}</p>}</div>
 <button className="btn-outline full settings-reset" disabled={busy} onClick={() => void change({ chartPair: c.defaultSymbol, chartInterval: c.defaultTimeframe as Preferences['chartInterval'], chartStyle: c.defaultChartType as Preferences['chartStyle'], grid: c.gridDefault, indicators: [] })}><RefreshCw size={16}/>{t('إعادة تعيين الشارت', 'Reset chart')}</button><p className="settings-footnote">{t('تُطبّق الخيارات التي يسمح بها تكامل TradingView. يظل شعار المصدر ظاهرًا.', 'Only supported TradingView options are applied. Provider attribution remains visible.')}</p></>;
}
export function AppearanceSettings(){
 const {prefs,t,change,status}=useOrin();
 const busy=status==='saving'||status==='loading';
 return <><h3 className="settings-section-label">{t('اختر المظهر', 'Choose appearance')}</h3><div className="theme-picker">{([['light', Sun, t('فاتح', 'Light')], ['dark', Moon, t('داكن', 'Dark')], ['system', Monitor, t('النظام', 'System')]] as const).map(([v, Icon, label]) => <button key={v} className={prefs.theme === v ? 'selected' : ''} aria-pressed={prefs.theme === v} disabled={busy} onClick={() => void change({ theme: v })}><span className={`theme-preview ${v}`}><Icon /></span>{label}{prefs.theme === v && <Check size={15}/>}</button>)}</div><section className="settings-group"><SettingsRow icon={<Globe2 />} title={t('لغة التطبيق', 'App language')}><SettingsSelect value={prefs.chartLocale} label="Language" items={[["ar", "العربية"], ["en", "English"], ["tr", "Türkçe"], ["de", "Deutsch"]]} disabled={busy} onChange={v => void change({ chartLocale: v as Preferences['chartLocale'] })}/></SettingsRow><SettingsRow icon={<Palette />} title={t('حجم الخط', 'Font size')}><SettingsSelect value={prefs.fontSize} label="Font size" items={[["small", t('صغير', 'Small')], ["normal", t('متوسط', 'Default')], ["large", t('كبير', 'Large')]]} disabled={busy} onChange={v => void change({ fontSize: v as Preferences['fontSize'] })}/></SettingsRow><SettingsRow icon={<SlidersHorizontal />} title={t('تنسيق الأرقام', 'Number format')} detail={t('أرقام إنجليزية في جميع اللغات', 'Latin digits in all languages')}><span className="num">1,234.56</span></SettingsRow><SettingsRow icon={<Wallet />} title={t('العملة المرجعية', 'Reference currency')} detail={t('تفضيل محفوظ؛ الأرصدة والتسوية تبقى USD حتى توصيل تحويل العملات.', 'Saved preference; balances and settlement remain USD until FX conversion is connected.')}><SettingsSelect value={prefs.referenceCurrency} label="Reference currency" items={[["USD", "USD"], ["EUR", "EUR"], ["GBP", "GBP"]]} disabled={busy} onChange={v => void change({ referenceCurrency: v as Preferences['referenceCurrency'] })}/></SettingsRow><SettingsRow icon={<Globe2 />} title={t('المنطقة الزمنية', 'Time zone')}><SettingsSelect value={prefs.timezone} label="Time zone" items={Array.from(new Set([prefs.timezone, 'Etc/UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Damascus', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'America/New_York', 'Asia/Tokyo'])).map(v => [v, v.replaceAll('_', ' ')])} disabled={busy} onChange={v => void change({ timezone: v })}/></SettingsRow><SettingsRow icon={<Monitor />} title={t('تقليل الحركة', 'Reduce motion')}><SettingsToggle label="Reduce motion" value={prefs.reduceMotion} disabled={busy} onChange={v => void change({ reduceMotion: v })}/></SettingsRow></section></>;
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
    const [panel, setPanel] = useRoutePanel('/settings', ['account', 'appearance', 'security', 'notifications', 'chart', 'about', 'admin', 'language', 'devices', 'privacy', 'documents', 'support', 'referral', 'agent', 'two-factor', 'authenticator', 'data', 'kyc'] as const);
    const navigation = useNavigation();
    const busy = status === 'saving' || status === 'loading';
    const titles = { account: t('الملف الشخصي', 'Your profile'), appearance: t('المظهر', 'Appearance'), security: t('مركز الأمان', 'Security center'), notifications: t('تفضيلات الإشعارات', 'Notification preferences'), chart: t('إعدادات الشارت', 'Chart settings'), about: t('حول ORIN', 'About ORIN'), admin: t('إدارة إعدادات الشارت', 'Admin chart settings'), language: t('اللغة', 'Language'), devices: t('الأجهزة', 'Devices'), privacy: t('الخصوصية', 'Privacy'), documents: t('المستندات', 'Documents'), support: t('الدعم', 'Support'), referral: t('مركز الإحالات', 'Referral center'), agent: t('مركز الوكلاء', 'Agent center'), 'two-factor': t('المصادقة الثنائية', 'Two-factor authentication'), data:t('البيانات والخصوصية','Data & privacy'), authenticator: t('تطبيق المصادقة', 'Authenticator setup'), kyc: t('توثيق الهوية (KYC)', 'Identity verification (KYC)') };
    const profile = settings?.profile;
    const activeAccount=state?.accountDirectory?.accounts.find(a=>a.id===state.accountDirectory?.activeId);
    const tier = state?.user.tier === 'advanced' ? t('متقدم', 'Advanced') : t('قياسي', 'Standard');
    const syncText = status === 'saving' ? t('جار الحفظ…', 'Saving…') : status === 'loading' ? t('جار المزامنة…', 'Syncing…') : status === 'synced' ? t('متزامن مع حسابك', 'Synced to your account') : status === 'guest' ? t('تفضيلات هذا الجهاز · سجّل الدخول للمزامنة', 'This device only · Sign in to sync') : t('تعذرت المزامنة', 'Sync unavailable');
    return <div className="settings-page settings-refresh" dir={prefs.chartLocale === 'ar' ? 'rtl' : 'ltr'}>
  <div className="settings-heading"><span className="eyebrow"><img src="/brand/orin-mark.png" alt="" width="22" height="22"/> YOUR ORIN</span><h1>{t('الحساب والإعدادات', 'Account & settings')}</h1><p>{t('تجربة مصممة على طريقتك.', 'Make ORIN feel like you.')}</p></div>
  <button className="settings-profile" onClick={() => setPanel('account')}><span className="settings-avatar"><UserRound /></span><span><strong>{profile?.displayName || state?.user.name || t('مرحبًا بك في ORIN', 'Welcome to ORIN')}</strong><small>{settings?.email??t('حسابك الشخصي','Your personal account')}</small><span className="profile-badges"><b>{t('حساب حقيقي','Real account')}</b><i>{tier}</i></span></span>{prefs.chartLocale==='ar'?<ChevronLeft/>:<ChevronRight/>}</button>
  <div className={`settings-sync ${status}`} role="status"><span />{syncText}{status === 'error' && <button onClick={() => void reload()} aria-label={t('إعادة المزامنة', 'Retry sync')}><RefreshCw size={15}/></button>}</div>{error && <p className="settings-error">{error}</p>}
  <div className="settings-shortcuts">
   <button onClick={()=>setPanel('appearance')}><span><Palette/></span><b>{t('المظهر','Appearance')}</b><small>{prefs.theme==='dark'?t('داكن','Dark'):prefs.theme==='system'?t('النظام','System'):t('فاتح','Light')}</small></button>
   <button onClick={()=>setPanel('language')}><span><Globe2/></span><b>{t('اللغة','Language')}</b><small>{{ar:'العربية',en:'English',tr:'Türkçe',de:'Deutsch'}[prefs.chartLocale]}</small></button>
  </div>
  <h2 className="settings-section-label">{t('حسابك وخصوصيتك','Your account & privacy')}</h2>
  <section className="settings-group">
   <SettingsRow icon={<UserRound/>} title={t('الحساب والملف الشخصي','Account & profile')} detail={t('بياناتك الشخصية وطرق التواصل','Personal details and contact information')} onClick={()=>setPanel('account')}/>
   <SettingsRow icon={<BadgeCheck/>} title={t('توثيق الهوية (KYC)','Identity verification (KYC)')} detail={t('تأكيد الهوية وتفعيل السحب والتداول الكامل','Verify identity and unlock account')} onClick={()=>setPanel('kyc')}/>
   <SettingsRow icon={<ShieldCheck/>} title={t('الأمان','Security')} detail={t('قفل التطبيق والمصادقة والجلسات','App lock, authentication and sessions')} onClick={()=>setPanel('security')}/>
   <SettingsRow icon={<LockKeyhole/>} title={t('الخصوصية والبيانات','Privacy & data')} onClick={()=>setPanel('data')}/>
  </section>
  <h2 className="settings-section-label">{t('تجربتك في ORIN','Your ORIN experience')}</h2>
  <section className="settings-group">
   <SettingsRow icon={<Bell/>} title={t('الإشعارات','Notifications')} detail={t('الأصوات والتنبيهات التي تهمك','Sounds and alerts that matter to you')} onClick={()=>setPanel('notifications')}/>
   <SettingsRow icon={<ChartCandlestick/>} title={t('الشارت والأسواق','Chart & markets')} detail={t('الأصول والفواصل والمؤشرات','Symbols, intervals and indicators')} onClick={()=>setPanel('chart')}/>
  </section>
  <h2 className="settings-section-label">{t('الحسابات والمعاملات','Accounts & transactions')}</h2>
  <section className="settings-group">
   <SettingsRow icon={<Wallet/>} title={t('الحسابات','Accounts')} detail={t('اختيار الحساب أو إنشاؤه من بطاقة الرصيد','Select or create an account from the balance card')} onClick={()=>navigation.navigate('/')}/>
   <SettingsRow icon={<ClipboardList/>} title={t('المعاملات الأخيرة','Recent transactions')} onClick={()=>navigation.navigate('/activity')}/>
   <SettingsRow icon={<Download/>} title={t('كشف حركات الحساب','Account statement')} detail="PDF" onClick={onLedger}/>
   <SettingsRow icon={<ClipboardList/>} title={t('المستندات','Documents')} onClick={()=>navigation.navigate('/documents')}/>
   <SettingsRow icon={<EyeOff/>} title={t('إخفاء الأرصدة','Hide balances')}><SettingsToggle label={t('إخفاء الأرصدة','Hide balances')} value={prefs.hideBalance} disabled={busy} onChange={hideBalance=>void change({hideBalance})}/></SettingsRow>
  </section>
  <h2 className="settings-section-label">{t('برامج ORIN','ORIN programs')}</h2><section className="settings-group">
   <SettingsRow icon={<Gift/>} title={t('دعوة صديق','Referral program')} onClick={()=>navigation.navigate('/referral')}/>
   <SettingsRow icon={<Globe2/>} title={t('شجرة الإحالات','Referral tree')} onClick={()=>navigation.navigate('/referral/tree')}/>
   <SettingsRow icon={<BadgeCheck/>} title={t('الشارات والإنجازات','Badges & achievements')} onClick={()=>navigation.navigate('/badges')}/>
   <SettingsRow icon={<Wallet/>} title={t('بونص الترحيب $100','Welcome bonus $100')} onClick={()=>navigation.navigate('/bonus')}/>
   <SettingsRow icon={<UserRound/>} title={t('برنامج الوكالة','Agency program')} onClick={()=>navigation.navigate('/agent')}/>
  </section>
  <h2 className="settings-section-label">{t('نحن هنا لمساعدتك','Here to help')}</h2><section className="settings-group">
   <SettingsRow icon={<Headphones/>} title={t('المساعدة والدعم','Help & support')} onClick={()=>navigation.navigate('/support')}/>
   <SettingsRow icon={<ClipboardList/>} title={t('الشروط والسياسات','Terms & policies')} onClick={onTerms}/>
   <SettingsRow icon={<Info/>} title={t('حول ORIN','About ORIN')} detail={APP_VERSION} onClick={()=>setPanel('about')}/>
  </section>
  {Boolean(state?.isAdmin || settings?.controlAvailable)&&<section className="settings-group"><SettingsRow icon={<ShieldCheck/>} title={t('مركز إدارة ORIN','ORIN Control Center')} detail={t('إدارة العملاء والصلاحيات والعمليات','Customers, permissions and operations')} onClick={()=>navigation.navigate('/admin')}/></section>}
  {state?.isAdmin&&<><h2 className="settings-section-label">{t('مساحة الإدارة','Administration')}</h2><section className="settings-group"><SettingsRow icon={<UserRound/>} title={t('إدارة المستخدمين','User management')} onClick={()=>navigation.navigate('/admin/users')}/><SettingsRow icon={<Wallet/>} title={t('المكافآت والبونص والوكالة','Rewards, bonus & agency')} onClick={()=>navigation.navigate('/admin/programs')}/><SettingsRow icon={<ClipboardList/>} title={t('العقود والدعوات','Contracts & invitations')} onClick={onAdmin}/><SettingsRow icon={<SlidersHorizontal/>} title={t('إعدادات الأسواق','Market settings')} onClick={()=>setPanel('admin')}/><SettingsRow icon={<Bell/>} title={t('إدارة الإشعارات','Notification administration')} onClick={()=>navigation.navigate('/admin/notifications')}/></section></>}
  {settings&&<a className="settings-row settings-signout" href={signOutUrl()}><LogOut/><strong>{t('تسجيل الخروج','Sign out')}</strong></a>}
  <Dialog open={panel !== null} onOpenChange={open => { if (!open)
        setPanel(null); }}><DialogContent pageClassName={'orin-settings-screen'+(panel==='account'?' orin-profile-screen':'')} className={`popup settings-dialog ${panel === 'admin' ? 'admin-settings-dialog' : ''}`} dir={prefs.chartLocale === 'ar' ? 'rtl' : 'ltr'}><DialogHeader><DialogTitle>{panel && titles[panel]}</DialogTitle><DialogDescription>{panel === 'admin' ? t('إعدادات عامة تتحقق منها المنصة على الخادم.', 'Server-enforced settings shared across devices.') : panel==='account'?t('بياناتك وإعدادات حسابك في مكان واحد.','Your details and account settings, together.'):syncText}</DialogDescription></DialogHeader>
  {panel&&['appearance','notifications','chart','security'].includes(panel)&&<div className="settings-panel-intro"><span>{panel==='appearance'?<Palette/>:panel==='notifications'?<Bell/>:panel==='chart'?<ChartCandlestick/>:<ShieldCheck/>}</span><div><b>{titles[panel]}</b><p>{panel==='appearance'?t('ألوان وتفاصيل تناسبك.','Colors and details, made for you.'):panel==='notifications'?t('اختر ما تريد سماعه ورؤيته.','Choose what you hear and see.'):panel==='chart'?t('تفضيلاتك للأسواق في مكان واحد.','Your market preferences in one place.'):t('راجع طرق حماية حسابك.','Review how your account is protected.')}</p></div></div>}
  {panel === 'account' && <ProfileSettings state={state} onSecurity={()=>setPanel('security')} onPrivacy={()=>setPanel('data')}/>}
  {panel === 'kyc' && <KycModal standalone onClose={()=>setPanel(null)} onSuccess={()=>setPanel(null)}/>}
  {panel === 'language' && <LanguageSettings/>}
  {panel === 'appearance' && <AppearanceSettings/>}
  {panel==='data'&&<DataControls/>}{panel === 'chart' && <ChartPreferences />}
  {panel === 'notifications' && <><SoundPreferences /><section className="settings-group"><SettingsRow icon={<Bell />} title={t('تنبيهات داخل التطبيق', 'In-app notifications')}><SettingsToggle label="In-app notifications" value={prefs.notifications} disabled={busy} onChange={v => void change({ notifications: v })}/></SettingsRow><SettingsRow icon={<Bell />} title={t('مركز الإشعارات', 'Notification center')} onClick={() => { setPanel(null); onNotifications(); }}/></section><h3 className="settings-section-label">{t('قنوات الإرسال', 'Delivery channels')}</h3><section className="settings-group">{['Push', 'Email', 'SMS'].map(channel => <SettingsRow key={channel} icon={<Bell />} title={channel} detail={t('خدمة الإرسال غير متصلة', 'Delivery service not connected')}><SettingsToggle label={channel} value={false} disabled onChange={() => { }}/></SettingsRow>)}</section><h3 className="settings-section-label">{t('الأحداث', 'Events')}</h3><section className="settings-group">{NOTICE_EVENTS.map(k => <SettingsRow key={k} icon={k === 'security' ? <ShieldAlert /> : <Bell />} title={t(...EVENT_NAMES[k])} detail={['opportunity', 'contract_started', 'contract_ended', 'settlement'].includes(k) ? undefined : t('تفضيل محفوظ للخدمة عند تفعيلها', 'Preference saved for when this service is connected')}><SettingsToggle label={EVENT_NAMES[k][1]} value={prefs.notificationEvents[k]} disabled={busy || k === 'security'} onChange={v => void change({ notificationEvents: { ...prefs.notificationEvents, [k]: v } })}/></SettingsRow>)}</section></>}
  {panel === 'security' && <SecurityCenter t={t} onPassword={()=>navigation.navigate('/account/security')}/>}
  {panel === 'two-factor' && <SecurityCenter t={t} initialPanel="totp"/>}{panel === 'authenticator' && <SecurityCenter t={t} initialPanel="totp"/>}{panel === 'devices' && <SecurityCenter t={t} initialPanel="sessions"/>}{panel === 'admin' && <AdminChartSettings />}
  {panel === 'about' && <div className="about-data"><h2>ORIN {APP_VERSION}</h2><a href="/privacy">{t('سياسة الخصوصية','Privacy policy')}</a><img src="/brand/orin-mark.png" alt="ORIN"/><p>{t('الشارت يستخدم Coinbase Exchange لشموع BTC/USD وTradingView للأصول الأخرى. قد تختلف درجة التأخير بحسب المصدر والسوق.', 'BTC/USD candles use Coinbase Exchange; other assets use TradingView. Delays vary by source and market.')}</p><p>{t('العقود الداخلية مستقلة عن السوق. تظهر نسبة التسوية المقفلة قبل المشاركة، ولا تمثل تنفيذًا لأمر في بورصة.', 'Internal contracts are independent of the market. Locked settlement terms are shown before participation and do not represent an exchange execution.')}</p><p>{t('تكامل Widget الحالي لا يتيح وقت آخر سعر لـ ORIN، أو حفظ الرسومات، أو تنبيهات أسعار خلفية. تغيير الرمز أو الفاصل يعيد تهيئة الشارت.', 'The current widget does not expose the last quote time, drawing storage or background price alerts to ORIN. Changing symbol or interval reinitializes the chart.')}</p><a href="https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/" target="_blank" rel="noopener noreferrer">TradingView <ExternalLink size={14}/></a></div>}
  </DialogContent></Dialog>
 </div>;
}

'use client';
import {copyReferral,shareReferral} from '@/lib/referral-sharing';
import {createContext,useContext,useEffect,useState} from 'react';
import {Copy,Share2,Users,Gift,RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import {ReferralServiceError,type ReferralSummary,type ReferralTransport} from '@/lib/referrals';
import {useNavigation} from './orin-navigation';
import {useOrin} from './orin-settings';
import {FullPage,FullPageContent,FullPageHeader,FullPageTitle} from './full-page';

export const ReferralContext=createContext<ReferralTransport|null>(null);

function ReferralRewardTable() {
  const { t } = useOrin();
  const tiers = [
    { deposit: '500', newMember: '20', referrer: '25' },
    { deposit: '1000', newMember: '50', referrer: '60' },
    { deposit: '2000', newMember: '120', referrer: '140' },
    { deposit: '3000', newMember: '210', referrer: '240' },
    { deposit: '5000', newMember: '400', referrer: '450' },
    { deposit: '10000', newMember: '800', referrer: '900' }
  ];

  return (
    <section className="program-card referral-rewards-table-card" style={{ marginTop: '16px', background: 'var(--orin-surface)', border: '1px solid var(--orin-line)', borderRadius: '18px', padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--orin-ink)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Gift size={20} style={{ color: '#0788ff' }} />
          {t('مكافأة الإحالات', 'Referral Rewards')}
        </h2>
        <span className="chip" style={{ background: 'rgba(7,136,255,0.12)', color: '#0788ff', fontWeight: 600 }}>
          {t('جدول المكافآت', 'Rewards Table')}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#0a1d37', color: '#ffffff', height: '42px' }}>
              <th style={{ padding: '8px 12px', borderTopLeftRadius: '10px' }}>{t('الاستثمار الجديد (USDT)', 'New Investment (USDT)')}</th>
              <th style={{ padding: '8px 12px' }}>{t('عضو جديد', 'New Member')}</th>
              <th style={{ padding: '8px 12px', borderTopRightRadius: '10px' }}>{t('موصي', 'Referrer')}</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((row, idx) => (
              <tr key={row.deposit} style={{ background: idx % 2 === 0 ? 'var(--orin-surface-soft)' : 'transparent', height: '44px', borderBottom: '1px solid var(--orin-line)' }}>
                <td style={{ fontWeight: 700, fontSize: '15px' }} className="num">{row.deposit}</td>
                <td style={{ color: '#0788ff', fontWeight: 600 }}>{row.newMember} {t('دولارًا أمريكيًا', 'USD')}</td>
                <td style={{ color: '#16c79a', fontWeight: 600 }}>{row.referrer} {t('دولارًا أمريكيًا', 'USD')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '16px', background: 'rgba(7,136,255,0.06)', border: '1px solid rgba(7,136,255,0.18)', borderRadius: '12px', padding: '14px', fontSize: '12px', lineHeight: 1.7, color: 'var(--orin-ink)' }}>
        <strong style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>{t('ملاحظات:', 'Notes:')}</strong>
        <p style={{ margin: '0 0 6px 0' }}>1. {t('الأعضاء الجدد الذين لديهم إيداع أولي أقل من 500 دولار أمريكي يمكنهم التقدم بطلب للحصول على مكافآت.', 'New members with initial deposit under $500 USD can apply for rewards.')}</p>
        <p style={{ margin: '0 0 6px 0' }}>2. {t('عند تقديم أحد أعضاء الفريق طلباً للحصول على جائزة، يحصل المدير الأعلى للجهة التي تقدم له المساعدة والتوجيه على جائزة دعم تتناسب مع المستوى المقدم.', 'When a team member submits a reward request, the managing lead offering guidance receives a support reward.')}</p>
        <p style={{ margin: 0 }}>3. {t('على المستثمرين الجدد الذين يستثمرون أكثر من 5000 USDT الحصول على موافقة من مؤسس مجموعة ORIN قبل الاستثمار.', 'New investors investing over 5000 USDT require approval prior to investment.')}</p>
      </div>
    </section>
  );
}

export function ReferralPage(){
 const service=useContext(ReferralContext),{path,back,navigate}=useNavigation(),{settings,t,number}=useOrin(),[data,setData]=useState<ReferralSummary|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0),open=path==='/referral';
 useEffect(()=>{if(!open)return;if(!service||!settings?.clientId){setError(t('خدمة الإحالات غير متاحة حاليًا.','Referral service is currently unavailable.'));return;}let active=true;setLoading(true);setError('');const timer=setTimeout(()=>{if(active){active=false;setLoading(false);setError(t('انتهت مهلة الاتصال. أعد المحاولة.','Connection timed out. Please retry.'))}},12000);void service.load(settings.clientId).then(value=>{if(active)setData(value)}).catch((error:unknown)=>{if(active)setError(error instanceof ReferralServiceError&&error.code==='unauthenticated'?t('انتهت جلسة الدخول. سجّل الدخول مجددًا.','Your session expired. Sign in again.'):error instanceof ReferralServiceError&&error.code==='permission-denied'?t('تعذّر الوصول إلى خدمة الإحالة من حسابك. تواصل مع الدعم.','Your account could not access referrals. Contact support.'):t('تعذر الاتصال بخدمة الإحالة. تحقق من الإنترنت وأعد المحاولة.','Could not connect to referrals. Check your connection and retry.'))}).finally(()=>{clearTimeout(timer);if(active)setLoading(false)});return()=>{active=false;clearTimeout(timer)}},[open,service,settings?.clientId,revision]);
 useEffect(()=>{if(!open)return;const online=()=>setRevision(v=>v+1);addEventListener('online',online);return()=>removeEventListener('online',online)},[open]);
 const origin = typeof window !== 'undefined' ? window.location.origin : 'https://orin-trader.top';
 const link = data ? `${origin}/register?ref=${encodeURIComponent(data.code)}` : '';
 const copy=async(value:string)=>{try{await copyReferral(value);toast.success(t('تم النسخ','Copied'))}catch{toast.error(t('تعذر النسخ؛ اضغط مطولًا على النص لنسخه.','Could not copy. Long-press the text to copy.'))}};
 const status=(value:string)=>({pending:t('بانتظار التحقق','Pending verification'),qualified:t('مؤهلة','Qualified'),approved:t('معتمدة','Approved'),paid:t('مدفوعة','Paid'),rejected:t('غير مؤهلة','Not eligible')}[value]??value);
 return <FullPage open={open} onOpenChange={v=>{if(!v)back('/')}}><FullPageContent className="referral-page"><FullPageHeader><FullPageTitle>{t('دعوة صديق','Invite a friend')}</FullPageTitle></FullPageHeader><section className="referral-hero"><img src="/brand/orin-mark.png" alt=""/><small>GROW WITH ORIN</small><h2>{t('تجربة أفضل، مع أصدقائك','Better together')}</h2><p>{t('شارك رابطك الخاص وتابع حالة إحالاتك هنا.','Share your personal link and follow your referrals here.')}</p></section>{loading&&!data&&<p role="status">{t('جار تجهيز إحالتك…','Preparing your referral…')}</p>}{error&&<div className="message error" role="alert">{error}<button onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/>{t('إعادة المحاولة','Retry')}</button><button onClick={()=>navigate('/support')}>{t('التواصل مع الدعم','Contact support')}</button></div>}{data&&<><section className="program-card referral-code-card"><label>{t('كود الإحالة','Referral code')}<input readOnly value={data.code} dir="ltr" onFocus={e=>e.target.select()}/></label><button className="btn-outline" onClick={()=>void copy(data.code)}><Copy/>{t('نسخ الكود','Copy code')}</button><label>{t('رابط الإحالة','Referral link')}<input readOnly value={link} dir="ltr" onFocus={e=>e.target.select()}/></label><div className="program-actions"><button className="btn-outline" onClick={()=>void copy(link)}><Copy/>{t('نسخ الرابط','Copy link')}</button><button className="btn-primary" onClick={async()=>{try{await shareReferral(link)}catch(e){if((e as Error).name!=='AbortError')toast.error(t('تعذرت المشاركة','Could not share'))}}}><Share2/>{t('مشاركة','Share')}</button></div></section>{data.summaryState&&data.summaryState!=='ready'&&<div className="referral-summary-status" role="status"><p>{data.summaryState==='pending'?t('كودك جاهز للمشاركة. لم تصل إحصاءات الإحالات والمكافآت بعد.','Your code is ready to share. Referral and reward statistics have not arrived yet.'):t('كودك جاهز للمشاركة. تعذر تحديث الإحصاءات الآن.','Your code is ready to share. Statistics could not be updated.')}</p><button disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/>{t('تحديث','Refresh')}</button></div>}<div className="program-metrics">{[[t('الأشخاص المدعوون','Invited people'),data.invited],[t('الإحالات الناجحة','Successful referrals'),data.successful],[t('إجمالي المكافآت','Total rewards'),data.totalRewardCents===null?null:'$'+number(data.totalRewardCents/100)]].map(([label,value])=><section key={label}><small>{label}</small><b dir="ltr">{value??'—'}</b></section>)}</div><ReferralRewardTable/>{!data.rewardsActive&&<p className="program-status">{t('المكافآت بانتظار تفعيل البرنامج واعتماد الشروط. الأرقام غير المتاحة لا تعني وجود مكافآت مستحقة.','Rewards await activation and approved terms. Unavailable figures do not imply earned rewards.')}</p>}<section className="program-card"><h2><Users size={19}/>{t('حالة الإحالات','Referral status')}</h2>{data.referrals.length?data.referrals.map(row=><div className="referral-record" key={row.id}><bdi>{row.id}</bdi><span>{status(row.status)}</span></div>):<p>{data.summaryState&&data.summaryState!=='ready'?t('سجل الإحالات لم يصل بعد.','Referral history has not arrived yet.'):t('لا توجد إحالات مسجّلة للعرض حاليًا.','No recorded referrals are available to display.')}</p>}</section><section className="program-card"><h2><Gift size={19}/>{t('سجل المكافآت','Reward history')}</h2>{data.rewards.length?data.rewards.map(row=><div className="referral-record" key={row.id}><span>{status(row.status)}</span><b dir="ltr">${number(row.amountCents/100)}</b></div>):<p>{data.summaryState&&data.summaryState!=='ready'?t('سجل المكافآت لم يصل بعد.','Reward history has not arrived yet.'):t('لا توجد مكافآت معتمدة للعرض حاليًا.','No approved rewards are available to display.')}</p>}</section><section className="program-card"><h2>{t('شروط برنامج الإحالة','Referral program terms')}</h2><p>{data.terms??t('ستظهر الشروط المعتمدة هنا عند تفعيل البرنامج. لا يُعد نسخ الرابط أو التسجيل وحده استحقاقًا لمكافأة. التحقق والأهلية والمكافآت تُعتمد من الخادم فقط.','Approved terms will appear here when the program is activated. Copying a link or signing up alone does not earn a reward. Verification, eligibility and rewards are approved by the server.')}</p></section></>}</FullPageContent></FullPage>;
}

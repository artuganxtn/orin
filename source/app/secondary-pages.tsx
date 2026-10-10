'use client';
import {SupportChat} from './support-chat';
import {ReferralPage} from './referral-page';
import {FileText,Users,Headphones,ShieldCheck,ClipboardList} from 'lucide-react';
import type {LabState} from '@/lib/contracts';
import {useOrin} from './orin-settings';
import {useNavigation} from './orin-navigation';
import {FullPage,FullPageContent,FullPageHeader,FullPageTitle,FullPageDescription} from './full-page';
import {lazy,Suspense} from 'react';
const ProgramPages=lazy(()=>import('./program-pages').then(m=>({default:m.ProgramPages})));
import {AdminNotifications} from './admin-notifications';
export function SecondaryPages({state}:{state:LabState|null}){const {path,back,navigate}=useNavigation(),{t}=useOrin();const data:Record<string,{title:[string,string];detail:[string,string];Icon:typeof FileText}>={
 '/documents':{title:['المستندات','Documents'],detail:['لا توجد مستندات جديدة. تظهر إيصالات التسوية في المراكز عند توفرها.','No new documents. Settlement receipts are available under Positions.'],Icon:FileText},
 '/support':{title:['الدعم','Support'],detail:['خدمة تذاكر الدعم غير متصلة بعد؛ لم يُرسل أي طلب.','Ticket support is not connected yet; no request has been sent.'],Icon:Headphones},
 '/referral':{title:['مركز الإحالات','Referral center'],detail:['لا توجد إحالات. لم يُفعّل برنامج مكافآت الإحالة بعد.','No referrals. A referral rewards program has not been enabled.'],Icon:Users},
 '/agent':{title:['مركز الوكلاء','Agent center'],detail:['خدمة الوكلاء والترقيات غير متصلة بعد.','Agent accounts and upgrades are not connected yet.'],Icon:ShieldCheck}};
 delete data['/referral'];delete data['/agent'];delete data['/support'];
 const page=data[path];return <><SupportChat/><ReferralPage/><FullPage open={!!page} onOpenChange={v=>{if(!v)back('/settings')}}><FullPageContent>{page&&<><FullPageHeader><FullPageTitle>{t(...page.title)}</FullPageTitle></FullPageHeader><div className="orin-empty"><page.Icon/><h2>{t(...page.title)}</h2><p>{t(...page.detail)}</p>{path==='/documents'&&<button className="btn-outline" onClick={()=>navigate('/positions')}>{t('عرض المراكز والإيصالات','View positions & receipts')}</button>}</div></>}</FullPageContent></FullPage>{['/referral/tree','/badges','/bonus','/agent','/admin/programs'].includes(path)&&<Suspense fallback={<div role="status">{t('جار التحميل…','Loading…')}</div>}><ProgramPages state={state}/></Suspense>}<AdminNotifications enabled={state?.isAdmin===true}/></>}

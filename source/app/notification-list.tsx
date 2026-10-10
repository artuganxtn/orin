'use client';
import {useEffect,useState} from 'react';
import {Bell,ChartNoAxesCombined,UserRound,ShieldCheck,ArrowDownToLine,ArrowUpFromLine,UsersRound,Headphones,Megaphone,ChevronLeft,ChevronRight} from 'lucide-react';
import type {InboxNotice} from '@/lib/notification-model';
import {noticeAppearance,notificationGroups,notificationTime,type NoticeFilter} from '@/lib/notification-presentation';
import {displayText} from '@/lib/display-text';
import {useOrin} from './orin-settings';
const icons={trading:ChartNoAxesCombined,account:UserRound,security:ShieldCheck,deposit:ArrowDownToLine,withdrawal:ArrowUpFromLine,referral:UsersRound,support:Headphones,announcement:Megaphone};
export function NotificationList({items,filter,onFilter,onOpen,onMore,total,loadingMore=false}:{items:InboxNotice[];filter:NoticeFilter;onFilter:(filter:NoticeFilter)=>void;onOpen:(notice:InboxNotice)=>void;onMore:()=>void;total:number;loadingMore?:boolean}){
 const {t,prefs}=useOrin(),[now,setNow]=useState(Date.now),groups=notificationGroups(items,filter,now),Chevron=prefs.chartLocale==='ar'?ChevronLeft:ChevronRight;
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer)},[]);
 const filters:[NoticeFilter,string][]=[['all',t('الكل','All')],['account',t('الحساب','Account')],['trading',t('التداول','Trading')],['security',t('الأمان','Security')]];
 return <>
  <div className="notice-category-tabs" role="group" aria-label={t('تصنيف الإشعارات','Notification categories')}>{filters.map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>onFilter(key)}>{label}</button>)}</div>
  <div className="notice-groups">{groups.map(group=><section key={group.id} className="notice-date-group"><h2>{group.id==='recent'?t('آخر 7 أيام','Last 7 days'):t('إشعارات سابقة','Earlier notifications')}</h2><div className="notice-card-list">{group.items.map(notice=>{
   const appearance=noticeAppearance(notice),Icon=icons[appearance.icon],unread=!notice.read_at;
   return <button type="button" className={'notice-card'+(unread?' is-unread':'')} key={notice.id} onClick={()=>onOpen(notice)} aria-label={`${displayText(notice.title)} · ${unread?t('غير مقروء','Unread'):t('مقروء','Read')}`}>
    <span className={'notice-card-icon '+appearance.icon}><Icon size={23} strokeWidth={1.7} aria-hidden="true"/>{unread&&<i className="notice-read-marker"/>}</span>
    <span className="notice-card-content"><span className="notice-card-heading"><strong dir="auto">{displayText(notice.title)}</strong><time dir="auto" dateTime={new Date(notice.created_at).toISOString()} title={new Intl.DateTimeFormat(prefs.chartLocale+'-u-nu-latn',{dateStyle:'medium',timeStyle:'short',timeZone:prefs.timezone}).format(notice.created_at)}>{notificationTime(notice.created_at,now,prefs.chartLocale,prefs.timezone)}</time></span><span className="notice-card-message" dir="auto">{displayText(notice.message)}</span></span>
    <Chevron className="notice-card-chevron" size={17} strokeWidth={1.7} aria-hidden="true"/>
   </button>;
  })}</div></section>)}</div>
  {!groups.length&&<div className="notice-empty"><span><Bell size={30} strokeWidth={1.5}/></span><h2>{t('أنت مطّلع على آخر الإشعارات','You’re all caught up')}</h2><p>{filter==='all'?t('ستظهر تحديثات حسابك هنا عند وصولها.','Your account updates will appear here.'):t('لا توجد إشعارات في هذا التصنيف ضمن السجل المعروض.','No notifications in this category in the loaded records.')}</p></div>}
  {items.length<total&&<button className="notice-more" disabled={loadingMore} onClick={onMore}>{loadingMore?t('جار تحميل المزيد…','Loading more…'):t('عرض المزيد','Load more')}</button>}
 </>;
}

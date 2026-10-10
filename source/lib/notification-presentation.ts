import type {InboxNotice} from './notification-model';

export type NoticeFilter='all'|'account'|'trading'|'security';
export type NoticeIcon='trading'|'account'|'security'|'deposit'|'withdrawal'|'referral'|'support'|'announcement';
export function noticeAppearance(notice:InboxNotice):{filter:Exclude<NoticeFilter,'all'>;icon:NoticeIcon}{
 if(notice.category==='security')return {filter:'security',icon:'security'};
 if(notice.category==='financial'){
  if(notice.deep_link==='/withdraw'||/^(?:withdrawal|withdraw)[:_-]/i.test(notice.id)||/سحب|\bwithdraw(?:al)?\b/i.test(notice.title))return {filter:'account',icon:'withdrawal'};
  if(notice.deep_link==='/deposit'||/^deposit[:_-]/i.test(notice.id)||/إيداع|ايداع|\bdeposit\b/i.test(notice.title))return {filter:'account',icon:'deposit'};
  if(notice.contract_id||notice.id.startsWith('settle:')||notice.deep_link.startsWith('/contracts/')||notice.deep_link.startsWith('/transactions/'))return {filter:'trading',icon:'trading'};
 }
 if(notice.category==='opportunity'||notice.category==='reminder'&&(!!notice.contract_id||/^(start|end):/.test(notice.id)))return {filter:'trading',icon:'trading'};
 return {filter:'account',icon:notice.category==='referral'?'referral':notice.category==='support'?'support':notice.category==='announcement'?'announcement':'account'};
}
export function noticeMatches(notice:InboxNotice,filter:NoticeFilter){return filter==='all'||noticeAppearance(notice).filter===filter}
export function notificationGroups(items:readonly InboxNotice[],filter:NoticeFilter,now:number){
 const rows=items.filter(n=>noticeMatches(n,filter)&&Number.isFinite(n.created_at)).slice().sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id));
 const cutoff=now-7*86400000;
 return [{id:'recent' as const,items:rows.filter(n=>n.created_at>=cutoff)},{id:'earlier' as const,items:rows.filter(n=>n.created_at<cutoff)}].filter(g=>g.items.length);
}
export function notificationTime(at:number,now:number,locale:string,timeZone:string){
 const age=Math.max(0,now-at),ar=locale==='ar';
 if(age<60000)return ar?'الآن':'Now';
 if(age<86400000){const unit=age<3600000?'minute':'hour',count=Math.max(1,Math.floor(age/(unit==='minute'?60000:3600000)));return new Intl.RelativeTimeFormat(ar?'ar-u-nu-latn':'en',{numeric:'always'}).format(-count,unit)}
 if(age<7*86400000)return new Intl.RelativeTimeFormat(ar?'ar-u-nu-latn':'en',{numeric:'always'}).format(-Math.floor(age/86400000),'day');
 return new Intl.DateTimeFormat(locale+'-u-nu-latn',{day:'numeric',month:'short',...(new Date(at).getUTCFullYear()!==new Date(now).getUTCFullYear()?{year:'numeric' as const}:{}),timeZone}).format(at);
}

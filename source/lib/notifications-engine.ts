import {AppError,sha256,type Database,type Identity} from './engine.ts';
import {noticeCategory,noticeDestination,type InboxNotice,type InboxState} from './notification-model.ts';
import {safeDestination} from './orin-routes.ts';
const q=(db:Database,sql:string,...v:unknown[])=>db.prepare(sql).bind(...v);
const eventSQL="CASE WHEN n.category<>'' THEN n.category WHEN n.id LIKE 'settle:%' THEN 'settlement' WHEN n.id LIKE 'start:%' THEN 'contract_started' WHEN n.id LIKE 'end:%' THEN 'contract_ended' ELSE 'opportunity' END";
// Account ownership, eligibility, language, expiry and preference checks are enforced on every read.
const visibleSQL=`(n.user_id=u.id OR (n.user_id IS NULL AND (n.eligibility='all' OR n.eligibility=u.tier))) AND n.created_at<=? AND (n.expires_at IS NULL OR n.expires_at>?) AND (n.category='security' OR COALESCE(json_extract(a.preferences,'$.notificationEvents.'||(${eventSQL})),1)<>0) AND (n.category<>'announcement' OR COALESCE(json_extract(a.preferences,'$.marketingNotifications'),0)=1)`;
const fromSQL='FROM lab_users u LEFT JOIN account_preferences a ON a.user_id=u.id JOIN notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=u.id';
export async function getInbox(db:Database,user:Identity,now=Date.now(),offset=0,id?:string):Promise<InboxState>{
 const args=[now,now,user.id];
 const row=await q(db,`SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN r.read_at IS NULL AND n.created_at>u.seen_at THEN 1 ELSE 0 END),0) unread ${fromSQL} WHERE ${visibleSQL} AND u.id=?`,...args).first<{total:number;unread:number}>();
 const items=await q(db,`SELECT n.*,COALESCE(r.read_at,CASE WHEN n.created_at<=u.seen_at THEN u.seen_at ELSE NULL END) read_at ${fromSQL} WHERE ${visibleSQL} AND u.id=?${id?' AND n.id=?':''} ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET ?`,...args,...(id?[id]:[]),offset).all<InboxNotice>();
 return {items:items.results.map(n=>({...n,category:noticeCategory(n),deep_link:noticeDestination(n)})),total:row?.total??0,unreadCount:row?.unread??0,serverTime:now,pushAvailable:false};
}
export async function readNotices(db:Database,user:Identity,input:Record<string,unknown>,now=Date.now()){
 if(input.all!==true&&(typeof input.id!=='string'||input.id.length>200))throw new AppError('Notification ID required');
 const clause=input.all===true?'':' AND n.id=?';const ids=input.all===true?[]:[input.id];
 await q(db,`INSERT OR IGNORE INTO notification_reads(user_id,notification_id,read_at) SELECT u.id,n.id,? ${fromSQL} WHERE ${visibleSQL} AND u.id=?${clause}`,now,now,now,user.id,...ids).run();return getInbox(db,user,now);
}
export type CampaignAudience={country:string;tier:'all'|'standard'|'advanced';users:string[]};
export interface Campaign{id:string;title:string;message:string;image:string;audience:string;language:string;deep_link:string;starts_at:number;expires_at:number;status:'draft'|'scheduled'|'sent'|'cancelled';revision:number;created_at:number;sent_at:number|null;recipient_count:number;}
async function admin(db:Database,user:Identity){const r=await q(db,"SELECT value FROM settings WHERE key='owner'").first<{value:string}>();if(r?.value!==user.id)throw new AppError('Administrator only',403)}
const audienceWhere=`COALESCE(json_extract(a.preferences,'$.marketingNotifications'),0)=1 AND COALESCE(json_extract(a.preferences,'$.notificationEvents.announcement'),1)<>0 AND COALESCE(json_extract(a.profile,'$.closureStatus'),'open')='open' AND (?='' OR json_extract(a.profile,'$.country')=?) AND (?='all' OR u.tier=?) AND (?='all' OR COALESCE(json_extract(a.preferences,'$.chartLocale'),'ar')=?)`;
function audienceArgs(c:Campaign){const a=JSON.parse(c.audience) as CampaignAudience;return [a.country,a.country,a.tier,a.tier,c.language,c.language]}
function userFilter(c:Campaign){const a=JSON.parse(c.audience) as CampaignAudience;return {sql:a.users.length?' AND u.id IN ('+a.users.map(()=>'?').join(',')+')':'',args:a.users};}
export async function campaignAudienceCount(db:Database,c:Campaign){const f=userFilter(c);return (await q(db,`SELECT COUNT(*) n FROM lab_users u JOIN account_preferences a ON a.user_id=u.id WHERE ${audienceWhere}${f.sql}`,...audienceArgs(c),...f.args).first<{n:number}>())?.n??0}
export async function listCampaigns(db:Database,user:Identity){await admin(db,user);return {campaigns:(await q(db,'SELECT * FROM notification_campaigns ORDER BY created_at DESC LIMIT 100').all<Campaign>()).results,pushAvailable:false,schedulerAvailable:false,audiences:{country:true,tier:true,specificUsers:true,agent:false,verified:false}}}
export async function saveCampaign(db:Database,user:Identity,input:Record<string,unknown>,now=Date.now()){
 await admin(db,user);
 const action=String(input.action??'draft');const existing=typeof input.id==='string'?await q(db,'SELECT * FROM notification_campaigns WHERE id=?',input.id).first<Campaign>():null;
 if(['send','cancel','preview'].includes(action)){
  if(!existing)throw new AppError('Campaign not found',404);
  if(action==='preview')return {campaign:existing,recipientCount:await campaignAudienceCount(db,existing)};
  if(existing.revision!==input.revision)throw new AppError('Campaign changed. Reload.',409);
  if(existing.status==='sent'||existing.status==='cancelled')throw new AppError('Campaign is already finalized',409);
  if(action==='cancel'){await q(db,"UPDATE notification_campaigns SET status='cancelled',revision=revision+1 WHERE id=? AND revision=? AND status IN ('draft','scheduled')",existing.id,existing.revision).run();return listCampaigns(db,user)}
  if(input.confirmed!==true)throw new AppError('Confirm campaign delivery',409);
  if(now<existing.starts_at)throw new AppError('Scheduled start has not arrived. Background scheduling is not connected.',409);
  if(now>=existing.expires_at)throw new AppError('Campaign expired',409);
  const count=await campaignAudienceCount(db,existing);if(!count)throw new AppError('No matching users have opted in to announcements.',409);
  if(input.expectedRecipients!==count)throw new AppError('Audience changed. Preview and confirm again.',409);
  const f=userFilter(existing),auditId='announcement:'+existing.id,payload=JSON.stringify({campaignId:existing.id,count}),hash=await sha256(payload);
  const result=await db.batch([
   q(db,`INSERT OR IGNORE INTO notifications(id,user_id,eligibility,title,message,created_at,category,deep_link,campaign_id,expires_at,image) SELECT 'campaign:'||?||':'||u.id,u.id,'all',?,?,?,'announcement',?,?,?,? FROM lab_users u JOIN account_preferences a ON a.user_id=u.id WHERE ${audienceWhere}${f.sql} AND EXISTS(SELECT 1 FROM notification_campaigns WHERE id=? AND revision=? AND status='draft') AND (SELECT COUNT(*) FROM lab_users u JOIN account_preferences a ON a.user_id=u.id WHERE ${audienceWhere}${f.sql})=?`,existing.id,existing.title,existing.message,now,existing.deep_link,existing.id,existing.expires_at,existing.image||null,...audienceArgs(existing),...f.args,existing.id,existing.revision,...audienceArgs(existing),...f.args,count),
   q(db,"UPDATE notification_campaigns SET status='sent',revision=revision+1,sent_at=?,recipient_count=(SELECT COUNT(*) FROM notifications WHERE campaign_id=?) WHERE id=? AND revision=? AND status='draft' AND (SELECT COUNT(*) FROM notifications WHERE campaign_id=?)=?",now,existing.id,existing.id,existing.revision,existing.id,count),
   q(db,"INSERT OR IGNORE INTO audit_events(id,actor_id,action,reference,payload,payload_hash,created_at) SELECT ?,?,'ANNOUNCEMENT_SENT',?,?,?,? WHERE EXISTS(SELECT 1 FROM notification_campaigns WHERE id=? AND status='sent' AND revision=?)",auditId,user.id,existing.id,payload,hash,now,existing.id,existing.revision+1),
  ]);if(!(result[1] as {meta?:{changes?:number}})?.meta?.changes)throw new AppError('Campaign changed. Reload and preview again.',409);return listCampaigns(db,user);
 }
 if(action!=='draft')throw new AppError('Background scheduling / Push delivery is not connected.',409);
 if(existing&&(existing.status!=='draft'||existing.revision!==input.revision))throw new AppError('Only the current draft can be edited',409);
 const title=typeof input.title==='string'?input.title.trim():'',message=typeof input.message==='string'?input.message.trim():'';
 if(!title||title.length>80||!message||message.length>500)throw new AppError('Title: 1–80 characters. Message: 1–500 characters.');
 const a=input.audience as CampaignAudience;if(!a||typeof a.country!=='string'||a.country!==''&&!/^[A-Z]{2}$/.test(a.country)||!['all','standard','advanced'].includes(a.tier)||!Array.isArray(a.users)||a.users.length>100||a.users.some(x=>typeof x!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(x)))throw new AppError('Invalid audience');
 const startsAt=Number(input.startsAt??now),expiresAt=Number(input.expiresAt??now+7*86400000);if(!Number.isSafeInteger(startsAt)||!Number.isSafeInteger(expiresAt)||expiresAt<=Math.max(now,startsAt)||expiresAt-now>90*86400000)throw new AppError('Invalid campaign dates');
 const language=String(input.language??'all');if(!['ar','en','all'].includes(language))throw new AppError('Invalid language');
 const link=safeDestination(input.deepLink);if(input.deepLink&&link!==input.deepLink)throw new AppError('Choose an ORIN page destination');
 const image=String(input.image??'');if(image&&!/^\/brand\/[A-Za-z0-9/_.-]+\.(png|jpg|webp|svg)$/.test(image)||image.includes('..'))throw new AppError('Use an existing image from /brand/');
 const id=existing?.id??crypto.randomUUID();
 if(existing)await q(db,"UPDATE notification_campaigns SET title=?,message=?,image=?,audience=?,language=?,deep_link=?,starts_at=?,expires_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='draft'",title,message,image,JSON.stringify(a),language,link,startsAt,expiresAt,id,existing.revision).run();
 else await q(db,"INSERT INTO notification_campaigns(id,title,message,image,audience,language,deep_link,starts_at,expires_at,status,revision,created_at,admin_id,recipient_count) VALUES(?,?,?,?,?,?,?,?,?,'draft',0,?,?,0)",id,title,message,image,JSON.stringify(a),language,link,startsAt,expiresAt,now,user.id).run();
 return {campaign:await q(db,'SELECT * FROM notification_campaigns WHERE id=?',id).first<Campaign>()};
}

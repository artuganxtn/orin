import {safeDestination} from './orin-routes.ts';
export const NOTICE_CATEGORIES=['opportunity','financial','security','announcement','reminder','referral','support'] as const;
export type NoticeCategory=typeof NOTICE_CATEGORIES[number];
export interface InboxNotice{id:string;title:string;message:string;contract_id:string|null;created_at:number;category:NoticeCategory;deep_link:string;read_at:number|null;image:string|null;}
export interface InboxState{items:InboxNotice[];unreadCount:number;total:number;serverTime:number;pushAvailable:boolean;}
export function noticeCategory(n:{id:string;category?:string}):NoticeCategory{if(NOTICE_CATEGORIES.includes(n.category as NoticeCategory))return n.category as NoticeCategory;if(n.id.startsWith('settle:'))return 'financial';if(n.id.startsWith('start:')||n.id.startsWith('end:'))return 'reminder';return 'opportunity';}
export function noticeDestination(n:{deep_link?:string;contract_id:string|null;id:string}){return n.deep_link?safeDestination(n.deep_link):n.contract_id?'/contracts/'+encodeURIComponent(n.contract_id):'/notifications';}

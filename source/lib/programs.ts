/** Shared display contracts; only trusted backend code can award money or roles. */
export const TEAM_LEVELS = [
 {level:1,direct:3,active:3,bps:75,capCents:2000},
 {level:2,direct:5,active:15,bps:125,capCents:6000},
 {level:3,direct:8,active:40,bps:175,capCents:15000},
 {level:4,direct:10,active:120,bps:225,capCents:35000},
 {level:5,direct:15,active:300,bps:275,capCents:75000},
 {level:6,direct:25,active:700,bps:325,capCents:150000},
] as const;
export const BADGES = [
 {id:'new_user',name:'New User',ar:'عضو جديد',metal:'silver'},
 {id:'verified',name:'Verified',ar:'موثّق',metal:'blue'},
 {id:'first_deposit',name:'First Deposit',ar:'أول إيداع',metal:'blue'},
 {id:'trader',name:'Trader',ar:'متداول',metal:'blue'},
 {id:'top_referrer',name:'Top Referrer',ar:'داعٍ متميز',metal:'gold'},
 {id:'team_leader',name:'Team Leader',ar:'قائد فريق',metal:'gold'},
 {id:'loyal_member',name:'Loyal Member',ar:'عضو وفيّ',metal:'silver'},
 {id:'elite',name:'Elite',ar:'النخبة',metal:'platinum'},
 {id:'legend',name:'Legend',ar:'الأسطورة',metal:'platinum'},
] as const;
export type RewardStatus='pending'|'qualified'|'approved'|'paid'|'rejected';
export function teamProgress(direct:number,active:number,levels:readonly {level:number;direct:number;active:number;bps:number;capCents:number}[]=TEAM_LEVELS){
 const current=[...levels].reverse().find(l=>direct>=l.direct&&active>=l.active);
 const next=levels.find(l=>l.level>(current?.level??0));
 return {current:current??null,next:next??null,percent:next?Math.floor(Math.min(1,direct/next.direct,active/next.active)*100):100};
}
export interface ProgramConfig {bonusAmountCents:number;referralAmountCents:number;firstDepositCents:number;requireKyc:boolean;levels:{level:number;direct:number;active:number;bps:number;capCents:number}[];enabled:boolean;termsVersion:string|null;referralCriteria:string|null;activeTeamCriteria:string|null;activityPeriod:string|null;bonusDurationDays:number|null;eligibleAssets:string[]|null;bonusProfitLimitCents:number|null;bonusTradingTerms:string|null;agencyCriteria:string|null;badgeCriteria:Record<string,string>;revision:number}
export const DEFAULT_PROGRAM_CONFIG:ProgramConfig={bonusAmountCents:10000,referralAmountCents:8000,firstDepositCents:100000,requireKyc:true,levels:TEAM_LEVELS.map(l=>({...l})),enabled:false,termsVersion:null,referralCriteria:null,activeTeamCriteria:null,activityPeriod:null,bonusDurationDays:null,eligibleAssets:null,bonusProfitLimitCents:null,bonusTradingTerms:null,agencyCriteria:null,badgeCriteria:{},revision:0};
export interface ProgramSummary {
 available:boolean;reason?:string;config:ProgramConfig;
 member:null|{referralId:string;code:string;agencyId:string|null;agencyGranted:boolean;badges:string[];direct:number;activeTeam:number;team:number;qualified:number;paidCents:number;pendingCents:number;activityRewardCents:number};
 bonus:null|{firstDepositCents?:number;termsVersion?:string;accountId:string;cashCents:number;bonusCents:number;profitCents:number;withdrawableProfitCents:number;qualifiedDepositCents:number;claimed:boolean;eligible:boolean};
 tree:{id:string;parentId:string|null;depth:number;status:RewardStatus}[];
 rewards:{id:string;status:RewardStatus;amountCents:number}[];truncated?:boolean;
}
export const unavailablePrograms=():ProgramSummary=>({available:false,reason:'backend_unavailable',config:{...DEFAULT_PROGRAM_CONFIG},member:null,bonus:null,tree:[],rewards:[]});

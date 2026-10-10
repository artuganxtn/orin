import type {RewardStatus} from './programs';
export type ReferralSummary={code:string;invited:number|null;successful:number|null;totalRewardCents:number|null;rewards:{id:string;status:RewardStatus;amountCents:number;createdAt?:number}[];referrals:{id:string;status:RewardStatus}[];terms:string|null;rewardsActive:boolean;summaryState?:'ready'|'pending'|'unavailable'};
export interface ReferralTransport{load(uid:string):Promise<ReferralSummary>}

export class ReferralServiceError extends Error {constructor(public code:string,public phase:'identity'|'backend'){super('Referral service: '+code);this.name='ReferralServiceError'}}

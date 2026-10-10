import {database} from '@/lib/database';
import {settingsIdentity,settingsBody,settingsResponse,settingsFailure} from '@/lib/settings-http';
import {listCampaigns,saveCampaign} from '@/lib/notifications-engine';
export const dynamic='force-dynamic';
export async function GET(){try{return settingsResponse(await listCampaigns(database(),await settingsIdentity()))}catch(e){return settingsFailure(e)}}
export async function POST(request:Request){try{const user=await settingsIdentity(),body=await settingsBody(request);return settingsResponse(await saveCampaign(database(),user,body))}catch(e){return settingsFailure(e)}}

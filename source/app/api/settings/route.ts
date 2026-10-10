import {database} from '@/lib/database';
import {getSettings,saveSettings} from '@/lib/settings-engine';
import {settingsIdentity,settingsBody,settingsResponse,settingsFailure} from '@/lib/settings-http';
export const dynamic='force-dynamic';
export async function GET(){try{return settingsResponse(await getSettings(database(),await settingsIdentity()));}catch(error){return settingsFailure(error);}}
export async function PATCH(request:Request){try{const user=await settingsIdentity(),body=await settingsBody(request);return settingsResponse(await saveSettings(database(),user,body));}catch(error){return settingsFailure(error);}}

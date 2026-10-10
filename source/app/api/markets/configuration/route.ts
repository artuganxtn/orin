import {database} from '@/lib/database';
import {getConfiguration,saveConfiguration} from '@/lib/settings-engine';
import {settingsIdentity,settingsBody,settingsResponse,settingsFailure} from '@/lib/settings-http';
export const dynamic='force-dynamic';
export async function GET(){try{return settingsResponse(await getConfiguration(database()));}catch(error){return settingsFailure(error);}}
export async function PATCH(request:Request){try{const user=await settingsIdentity(),body=await settingsBody(request);return settingsResponse(await saveConfiguration(database(),user,body));}catch(error){return settingsFailure(error);}}

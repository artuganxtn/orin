import {database} from '@/lib/database';
import {verifyInvitation} from '@/lib/engine';
import {settingsIdentity,settingsBody,settingsResponse,settingsFailure} from '@/lib/settings-http';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await settingsIdentity(),body=await settingsBody(request);return settingsResponse(await verifyInvitation(database(),user,body.code));}catch(error){return settingsFailure(error);}}

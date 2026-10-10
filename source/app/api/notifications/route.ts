import {database} from '@/lib/database';
import {settingsIdentity,settingsBody,settingsResponse,settingsFailure} from '@/lib/settings-http';
import {getInbox,readNotices} from '@/lib/notifications-engine';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await settingsIdentity(),params=new URL(request.url).searchParams;const offset=Math.max(0,Math.min(10000,Number(params.get('offset'))||0));return settingsResponse(await getInbox(database(),user,Date.now(),Math.floor(offset),params.get('id')?.slice(0,200)))}catch(e){return settingsFailure(e)}}
export async function POST(request:Request){try{const user=await settingsIdentity(),body=await settingsBody(request);return settingsResponse(await readNotices(database(),user,body))}catch(e){return settingsFailure(e)}}

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database } from "@/lib/database";
import { AppError,getState,performAction } from "@/lib/engine";
export const dynamic="force-dynamic";
async function identity(){const user=await getChatGPTUser();if(!user)throw new AppError("سجّل الدخول بحساب ChatGPT لفتح بيئتك الخاصة.",401);return {id:user.userId,name:user.fullName??"حساب أورين"};}
function failure(error:unknown){if(error instanceof AppError)return Response.json({error:error.message},{status:error.status});console.error("lab error",error);return Response.json({error:"تعذر تحديث بيانات الحساب. أعد المحاولة."},{status:503});}
export async function GET(){try{return Response.json(await getState(database(),await identity()),{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new AppError("مصدر الطلب غير مسموح.",403);if(!request.headers.get("content-type")?.includes("application/json"))throw new AppError("نوع الطلب غير صحيح.",415);const text=await request.text();if(text.length>6000)throw new AppError("الطلب أكبر من المسموح.",413);let body;try{body=JSON.parse(text);}catch{throw new AppError("بيانات الطلب غير صالحة.");}if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError("بيانات الطلب غير صالحة.");return Response.json(await performAction(database(),await identity(),body),{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}

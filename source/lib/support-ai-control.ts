/** Shared public configuration schema. Provider credentials/endpoints are never UI settings. */
export const SUPPORTED_GEMINI_MODELS = ['gemini-2.0-flash','gemini-1.5-flash','gemini-1.5-flash-8b','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite'] as const;
export type SupportAIConfig = {enabled:boolean;provider:'gemini'|'openai-compatible';model:string;maxTokensPerReply:number;dailyTokenBudget:number;systemInstructions:string};
export const SUPPORT_AI_DEFAULTS: SupportAIConfig = {enabled:false,provider:'gemini',model:'gemini-2.0-flash',maxTokensPerReply:700,dailyTokenBudget:50000,systemInstructions:''};
export const SUPPORT_AI_CONFIG_FIELDS = Object.keys(SUPPORT_AI_DEFAULTS) as (keyof SupportAIConfig)[];
const secret = /\bAIza[0-9A-Za-z_-]{20,}|\bsk-[0-9A-Za-z_-]{16,}|-----BEGIN[^\n]*PRIVATE KEY|otpauth:\/\//i;
export function validateSupportText(value:unknown,max:number,empty=false):string {
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||secret.test(value))throw new Error('نص غير صالح أو يتضمن بيانات سرية. / Invalid or sensitive text.');
 return value.trim();
}
export function parseSupportAIConfig(raw:unknown):SupportAIConfig {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid assistant settings.');
 const d=raw as Record<string,unknown>;
 if(Object.keys(d).some(key=>!SUPPORT_AI_CONFIG_FIELDS.includes(key as keyof SupportAIConfig)))throw new Error('Only approved assistant settings are editable.');
 const c={...SUPPORT_AI_DEFAULTS,...d};
 if(typeof c.enabled!=='boolean'||!['gemini','openai-compatible'].includes(c.provider as string)||typeof c.model!=='string'||!/^[A-Za-z0-9_.:/-]{1,160}$/.test(c.model))throw new Error('Invalid provider or model.');
 if(c.provider==='gemini'&&!SUPPORTED_GEMINI_MODELS.includes(c.model as typeof SUPPORTED_GEMINI_MODELS[number]))throw new Error('The Gemini model is not approved for this deployment.');
 if(!Number.isSafeInteger(c.maxTokensPerReply)||Number(c.maxTokensPerReply)<128||Number(c.maxTokensPerReply)>2048||!Number.isSafeInteger(c.dailyTokenBudget)||Number(c.dailyTokenBudget)<1000||Number(c.dailyTokenBudget)>1000000||Number(c.dailyTokenBudget)<Number(c.maxTokensPerReply))throw new Error('Reply limit 128–2048; daily budget 1,000–1,000,000 tokens and at least one reply.');
 return {...c,systemInstructions:validateSupportText(c.systemInstructions,1500,true)} as SupportAIConfig;
}

import {APP_LOCALES} from './locales';
import {AppError,bootstrap,sha256,type Database,type Identity} from './engine.ts';
import {CAPABILITIES,CHART_KEYS,DEFAULT_CONFIGURATION,DEFAULT_PREFERENCES,INDICATORS,NOTICE_EVENTS,TIMEFRAMES,CHART_TYPES,parsePreferences,validTimezone,type MarketConfiguration,type SettingsState,type AccountProfile} from './preferences.ts';
import {MARKET_SYMBOLS} from './market-symbols.ts';
type AccountRow={preferences:string;profile:string;revision:number;updated_at:number};
const statement=(db:Database,sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function checkKeys(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).some(k=>!keys.includes(k)))throw new AppError('إعداد غير مسموح / Unsupported setting.');}
function enumValue(v:unknown,all:readonly string[]){if(typeof v!=='string'||!all.includes(v))throw new AppError('قيمة إعداد غير مسموحة / Setting is not allowed.');}
function boolean(v:unknown){if(typeof v!=='boolean')throw new AppError('قيمة منطقية مطلوبة / Boolean required.');}
function list(v:unknown,all:readonly string[],nonempty=false){if(!Array.isArray(v)||v.length>all.length||(nonempty&&!v.length)||new Set(v).size!==v.length||v.some(x=>typeof x!=='string'||!all.includes(x)))throw new AppError('قائمة إعدادات غير صالحة / Invalid options.');}
export async function getConfiguration(db:Database){const row=await statement(db,'SELECT configuration,revision,updated_at FROM market_configuration WHERE id=1').first<{configuration:string;revision:number;updated_at:number}>();return {configuration:row?JSON.parse(row.configuration) as MarketConfiguration:structuredClone(DEFAULT_CONFIGURATION),configurationRevision:row?.revision??0,updatedAt:row?.updated_at??0,capabilities:CAPABILITIES};}
async function owner(db:Database,id:string){return (await statement(db,"SELECT value FROM settings WHERE key='owner'").first<{value:string}>())?.value===id;}
async function initialize(db:Database,user:Identity,now:number){await bootstrap(db,user,now);await db.batch([statement(db,'INSERT OR IGNORE INTO account_preferences(user_id,updated_at) VALUES(?,?)',user.id,now),statement(db,'INSERT OR IGNORE INTO chart_preferences(user_id,updated_at) VALUES(?,?)',user.id,now)]);}
export async function getSettings(db:Database,user:Identity&{email?:string},now=Date.now()):Promise<SettingsState>{
 await initialize(db,user,now);
 const [account,chart,config,isAdmin]=await Promise.all([statement(db,'SELECT * FROM account_preferences WHERE user_id=?',user.id).first<AccountRow>(),statement(db,'SELECT preferences FROM chart_preferences WHERE user_id=?',user.id).first<{preferences:string}>(),getConfiguration(db),owner(db,user.id)]);
 const profile={displayName:user.name,phone:'',country:'',closureStatus:'open',...JSON.parse(account!.profile)} as AccountProfile;
 return {...config,updatedAt:account!.updated_at,revision:account!.revision,preferences:parsePreferences({...JSON.parse(account!.preferences),...JSON.parse(chart!.preferences)},config.configuration),profile,isAdmin,email:user.email??'',clientId:user.id};
}
export function validatePreferences(p:Record<string,unknown>,c:MarketConfiguration){
 checkKeys(p,Object.keys(DEFAULT_PREFERENCES));
 for(const [key,value] of Object.entries(p)){
  if(['hideBalance','notifications','reduceMotion','grid','notificationSounds','opportunitySound','securitySound','vibration','marketingNotifications'].includes(key))boolean(value);
  else if(key==='chartPair')enumValue(value,c.enabledSymbols);
  else if(key==='chartInterval')enumValue(value,c.enabledTimeframes);
  else if(key==='chartStyle')enumValue(value,c.enabledChartTypes);
  else if(key==='chartLocale')enumValue(value,APP_LOCALES);
  else if(key==='theme')enumValue(value,['light','dark','system']);
  else if(key==='fontSize')enumValue(value,['small','normal','large']);
  else if(key==='numberFormat')enumValue(value,['latin','arabic']);
  else if(key==='referenceCurrency')enumValue(value,['USD','EUR','GBP']);
  else if(key==='timezone'){if(!validTimezone(value))throw new AppError('منطقة زمنية غير صالحة / Invalid timezone.');}
  else if(key==='indicators')list(value,c.allowedIndicators);
  else if(key==='favorites')list(value,c.favorites?c.enabledSymbols:[]);
  else if(key==='notificationEvents'){if(!object(value))throw new AppError('Invalid notification events');checkKeys(value,[...NOTICE_EVENTS]);Object.values(value).forEach(boolean);if(value.security===false)throw new AppError('Security account notices are required.',409);}
  else if(key==='notificationChannels'){if(!object(value))throw new AppError('Invalid notification channels');checkKeys(value,['push','email','sms']);if(Object.values(value).some(x=>x!==false))throw new AppError('خدمة الإرسال غير متصلة / Delivery service is not connected.',409);}
  else if((key==='crosshair'||key==='priceLine')&&value!==true||key==='saveDrawings'&&value!==false)throw new AppError('هذا التحكم غير مدعوم في التكامل الحالي / Integration does not support this control.',409);
 }
}
export async function saveSettings(db:Database,user:Identity&{email?:string},input:Record<string,unknown>,now=Date.now()){
 checkKeys(input,['revision','preferences','profile','closeAccount']);
 const current=await getSettings(db,user,now);
 if(!Number.isSafeInteger(input.revision)||input.revision!==current.revision)throw new AppError('تغيرت الإعدادات على جهاز آخر. أعد تحميلها / Settings changed on another device. Reload.',409);
 const patch=input.preferences??{};if(!object(patch))throw new AppError('Invalid preferences');validatePreferences(patch,current.configuration);
 const preferences=parsePreferences({...current.preferences,...patch,notificationEvents:{...current.preferences.notificationEvents,...(object(patch.notificationEvents)?patch.notificationEvents:{})}},current.configuration);
 const profile={...current.profile};
 if(input.profile!==undefined){if(!object(input.profile))throw new AppError('Invalid profile');checkKeys(input.profile,['displayName','phone','country']);for(const [key,value] of Object.entries(input.profile)){
  if(typeof value!=='string')throw new AppError('Invalid profile value');const text=value.trim();if(key==='displayName'&&(!text||text.length>100)||key==='phone'&&text!==''&&!/^\+?[0-9 ()-]{6,24}$/.test(text)||key==='country'&&text!==''&&!/^[A-Z]{2}$/.test(text))throw new AppError('تحقق من بيانات الحساب / Check account details.');profile[key as 'displayName'|'phone'|'country']=text;
 }}
 if(input.closeAccount!==undefined){if(input.closeAccount!==true)throw new AppError('Confirmation required');const active=await statement(db,"SELECT COUNT(*) n FROM positions WHERE user_id=? AND status='active'",user.id).first<{n:number}>();if(active?.n)throw new AppError('أكمل العقود النشطة قبل طلب الإغلاق / Settle active contracts first.',409);profile.closureStatus='requested';}
 const chart:Record<string,unknown>={},general:Record<string,unknown>={};for(const [k,v] of Object.entries(preferences))(CHART_KEYS.includes(k as typeof CHART_KEYS[number])?chart:general)[k]=v;
 // Audit insertion is gated by the compare-and-swap. D1 commits the batch atomically.
 const auditId=crypto.randomUUID(),payload=JSON.stringify({revision:current.revision+1,fields:Object.keys(patch),profileFields:object(input.profile)?Object.keys(input.profile):[],closureRequested:input.closeAccount===true}),hash=await sha256(payload);
 await db.batch([
  statement(db,`INSERT INTO audit_events(id,actor_id,action,reference,payload,payload_hash,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM account_preferences WHERE user_id=? AND revision=?) AND COALESCE((SELECT revision FROM market_configuration WHERE id=1),0)=? AND (?=0 OR NOT EXISTS(SELECT 1 FROM positions WHERE user_id=? AND status='active'))`,auditId,user.id,input.closeAccount?'ACCOUNT_CLOSURE_REQUESTED':'PREFERENCES_UPDATED',user.id,payload,hash,now,user.id,current.revision,current.configurationRevision,input.closeAccount===true?1:0,user.id),
  statement(db,'UPDATE account_preferences SET preferences=?,profile=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=?)',JSON.stringify(general),JSON.stringify(profile),now,user.id,current.revision,auditId),
  statement(db,'UPDATE chart_preferences SET preferences=?,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=?)',JSON.stringify(chart),now,user.id,auditId),
 ]);
 if(!await statement(db,'SELECT id FROM audit_events WHERE id=?',auditId).first())throw new AppError('تعارض مزامنة. أعد تحميل الإعدادات / Sync conflict. Reload.',409);
 return getSettings(db,user,now);
}
export async function saveConfiguration(db:Database,user:Identity,input:Record<string,unknown>,now=Date.now()){
 await initialize(db,user,now);if(!await owner(db,user.id))throw new AppError('متاح للإدارة فقط / Administrator only.',403);
 checkKeys(input,['revision','configuration']);const previous=await getConfiguration(db);
 if(input.revision!==previous.configurationRevision)throw new AppError('تغيرت إعدادات الإدارة. أعد التحميل / Reload configuration.',409);
 if(!object(input.configuration))throw new AppError('Invalid configuration');checkKeys(input.configuration,Object.keys(DEFAULT_CONFIGURATION));
 const c={...previous.configuration,...input.configuration} as MarketConfiguration;
 list(c.enabledSymbols,MARKET_SYMBOLS.map(s=>s.pair),true);list(c.enabledTimeframes,TIMEFRAMES,true);list(c.enabledChartTypes,CHART_TYPES,true);list(c.allowedIndicators,INDICATORS);list(c.allowedDrawingTools,[]);
 enumValue(c.defaultSymbol,c.enabledSymbols);enumValue(c.defaultTimeframe,c.enabledTimeframes);enumValue(c.defaultChartType,c.enabledChartTypes);
 for(const k of ['volume','gridDefault','crosshairDefault','fullscreen','alerts','favorites'] as const)boolean(c[k]);
 if(c.alerts||!c.crosshairDefault)throw new AppError('ميزة غير متصلة بالتكامل الحالي / Capability not connected.',409);
 const id=crypto.randomUUID(),payload=JSON.stringify({before:previous.configuration,after:c,revision:previous.configurationRevision+1}),hash=await sha256(payload);
 await db.batch([
  statement(db,'INSERT OR IGNORE INTO market_configuration(id,configuration,revision,updated_at,admin_id) VALUES(1,?,0,?,?)',JSON.stringify(DEFAULT_CONFIGURATION),now,user.id),
  statement(db,"INSERT INTO audit_events(id,actor_id,action,reference,payload,payload_hash,created_at) SELECT ?,?,'MARKET_CONFIGURATION_UPDATED','markets',?,?,? WHERE EXISTS(SELECT 1 FROM market_configuration WHERE id=1 AND revision=?)",id,user.id,payload,hash,now,previous.configurationRevision),
  statement(db,'UPDATE market_configuration SET configuration=?,revision=revision+1,updated_at=?,admin_id=? WHERE id=1 AND revision=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=?)',JSON.stringify(c),now,user.id,previous.configurationRevision,id),
 ]);
 if(!await statement(db,'SELECT id FROM audit_events WHERE id=?',id).first())throw new AppError('تعارض إعدادات الإدارة / Configuration conflict.',409);
 return getConfiguration(db);
}

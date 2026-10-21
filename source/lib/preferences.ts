import {isLocale,type AppLocale} from './locales';
import { MARKET_SYMBOLS } from './market-symbols.ts';
export const TIMEFRAMES = ['1','5','15','60','240','D'] as const;
export const CHART_TYPES = ['1','2','3'] as const;
export const INDICATORS = ['MA','EMA','RSI','MACD','BB'] as const;
export const NOTICE_EVENTS = ['opportunity','contract_started','contract_ended','settlement','deposit','withdrawal','referral','agent','support','security','announcement','reminder'] as const;
export type NoticeEvent = typeof NOTICE_EVENTS[number];
export interface Preferences {
 hideBalance:boolean; notifications:boolean; reduceMotion:boolean; notificationSounds:boolean; opportunitySound:boolean; securitySound:boolean; vibration:boolean; marketingNotifications:boolean;
 chartLocale:AppLocale; theme:'light'|'dark'|'system'; fontSize:'small'|'normal'|'large';
 numberFormat:'latin'|'arabic'; referenceCurrency:'USD'|'EUR'|'GBP'; timezone:string;
 chartPair:string; chartInterval:typeof TIMEFRAMES[number]; chartStyle:typeof CHART_TYPES[number];
 grid:boolean; crosshair:boolean; priceLine:boolean; saveDrawings:boolean;
 indicators:string[]; favorites:string[];
 notificationEvents:Record<NoticeEvent,boolean>;
 notificationChannels:{push:boolean;email:boolean;sms:boolean};
}
export interface MarketConfiguration {
 defaultSymbol:string; enabledSymbols:string[]; defaultTimeframe:string; enabledTimeframes:string[];
 defaultChartType:string; enabledChartTypes:string[]; allowedIndicators:string[]; allowedDrawingTools:string[];
 volume:boolean; gridDefault:boolean; crosshairDefault:boolean; fullscreen:boolean; alerts:boolean; favorites:boolean;
}
export const CAPABILITIES = Object.freeze({provider:'tradingview-widget',kyc:true,deposits:true,withdrawals:true,transfer:true,referrals:true,indicators:true,drawings:false,saveDrawings:false,priceAlerts:false,quoteTelemetry:false,inPlaceUpdates:false,crosshairControl:false,priceLineControl:false,push:false,email:false,sms:false,password:true,totp:false,passkeys:false,biometrics:false,recoveryCodes:false,sessionManagement:false});
export const DEFAULT_CONFIGURATION:MarketConfiguration={defaultSymbol:'BTC-USD',enabledSymbols:MARKET_SYMBOLS.map(s=>s.pair),defaultTimeframe:'15',enabledTimeframes:[...TIMEFRAMES],defaultChartType:'1',enabledChartTypes:[...CHART_TYPES],allowedIndicators:[...INDICATORS],allowedDrawingTools:[],volume:false,gridDefault:true,crosshairDefault:true,fullscreen:true,alerts:false,favorites:true};
const detectedTimezone = () => {
  try {
    return (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Etc/UTC';
  } catch {
    return 'Etc/UTC';
  }
};
export const DEFAULT_PREFERENCES:Preferences={hideBalance:false,notifications:true,reduceMotion:false,notificationSounds:false,opportunitySound:true,securitySound:true,vibration:false,marketingNotifications:false,chartLocale:'ar',theme:'light',fontSize:'normal',numberFormat:'latin',referenceCurrency:'USD',timezone:detectedTimezone(),chartPair:'BTC-USD',chartInterval:'15',chartStyle:'1',grid:true,crosshair:true,priceLine:true,saveDrawings:false,indicators:[],favorites:[],notificationEvents:Object.fromEntries(NOTICE_EVENTS.map(k=>[k,true])) as Preferences['notificationEvents'],notificationChannels:{push:false,email:false,sms:false}};
export const PREFERENCES_KEY='orin-preferences-v2';
export const CHART_KEYS=['chartPair','chartInterval','chartStyle','grid','crosshair','priceLine','saveDrawings','indicators','favorites'] as const;
const includes=(all:readonly string[],v:unknown)=>typeof v==='string'&&all.includes(v);
export function validTimezone(value:unknown):value is string {if(typeof value!=='string'||value.length>80)return false;try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true;}catch{return false;}}
export function parsePreferences(value:unknown,c:MarketConfiguration=DEFAULT_CONFIGURATION):Preferences {
 const p=(value&&typeof value==='object'?value:{}) as Partial<Preferences>;
 const list=(v:unknown,allowed:string[])=>Array.isArray(v)?[...new Set(v.filter((x):x is string=>typeof x==='string'&&allowed.includes(x)))]:[];
 const userTz = validTimezone(p.timezone) && p.timezone !== 'Etc/UTC' ? p.timezone : detectedTimezone();
 return {...DEFAULT_PREFERENCES,hideBalance:p.hideBalance===true,notifications:p.notifications!==false,notificationSounds:p.notificationSounds===true,opportunitySound:p.opportunitySound!==false,securitySound:p.securitySound!==false,vibration:p.vibration===true,marketingNotifications:p.marketingNotifications===true,reduceMotion:p.reduceMotion===true,chartLocale:isLocale(p.chartLocale)?p.chartLocale:'ar',theme:includes(['light','dark','system'],p.theme)?p.theme!:DEFAULT_PREFERENCES.theme,fontSize:includes(['small','normal','large'],p.fontSize)?p.fontSize!:'normal',numberFormat:'latin',referenceCurrency:includes(['USD','EUR','GBP'],p.referenceCurrency)?p.referenceCurrency!:'USD',timezone:userTz,chartPair:includes(c.enabledSymbols,p.chartPair)?p.chartPair!:c.defaultSymbol,chartInterval:(includes(c.enabledTimeframes,p.chartInterval)?p.chartInterval:c.defaultTimeframe) as Preferences['chartInterval'],chartStyle:(includes(c.enabledChartTypes,p.chartStyle)?p.chartStyle:c.defaultChartType) as Preferences['chartStyle'],grid:typeof p.grid==='boolean'?p.grid:c.gridDefault,crosshair:true,priceLine:true,saveDrawings:false,indicators:list(p.indicators,c.allowedIndicators),favorites:c.favorites?list(p.favorites,c.enabledSymbols):[],notificationEvents:Object.fromEntries(NOTICE_EVENTS.map(k=>[k,k==='security'||p.notificationEvents?.[k]!==false])) as Preferences['notificationEvents'],notificationChannels:{push:false,email:false,sms:false}};
}
export interface AccountProfile {displayName:string;phone:string;country:string;closureStatus:'open'|'requested';}
export interface SettingsState {controlAvailable?:boolean;preferences:Preferences;profile:AccountProfile;revision:number;configuration:MarketConfiguration;configurationRevision:number;isAdmin:boolean;email:string;clientId:string;updatedAt:number;capabilities:typeof CAPABILITIES;}

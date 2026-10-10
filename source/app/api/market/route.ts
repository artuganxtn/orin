import type { Candle, MarketData } from "@/lib/contracts";
export const dynamic="force-dynamic";
const cache=new Map<string,{expires:number;data:MarketData}>();
const pairs=['BTC-USD','ETH-USD','XRP-USD','SOL-USD','BNB-USD','DOGE-USD','TON-USD','ADA-USD'];
const frames:Record<string,number>={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1D':86400};
const ranges:Record<string,[number,number]>={'1H':[3600,60],'1D':[86400,900],'1W':[604800,3600],'1M':[2592000,21600],'1Y':[31536000,86400],'ALL':[31536000,86400]};
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,pair=params.get('pair')??'BTC-USD',range=params.get('range'),frame=params.get('frame')??'5m';
 if(!pairs.includes(pair))return Response.json({error:'هذا الأصل غير متصل بمزود البيانات.'},{status:400});
 if((range&&!Object.hasOwn(ranges,range))||!Object.hasOwn(frames,frame))return Response.json({error:'الفترة غير مدعومة.'},{status:400});
 const key=`${pair}:${range??frame}`,hit=cache.get(key);if(hit&&hit.expires>Date.now())return Response.json(hit.data);
 try{
  const base=`https://api.exchange.coinbase.com/products/${pair}`;
  const seconds=range?ranges[range][0]:frames[frame]*60,granularity=range?ranges[range][1]:(frame==='4h'?3600:frames[frame]);
  const read=async<T,>(path:string):Promise<T>=>{const r=await fetch(base+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});if(!r.ok)throw new Error(`Provider ${r.status}`);return await r.json() as T;};
  const end=Date.now(),start=end-seconds*1000;
  const batches:Promise<unknown>[]=[];
  for(let at=start;at<end;at+=granularity*240000){const until=Math.min(end,at+granularity*240000);batches.push(read(`/candles?granularity=${granularity}&start=${new Date(at).toISOString()}&end=${new Date(until).toISOString()}`));}
  const [ticker,stats,raw]=await Promise.all([read<Record<string,unknown>>('/ticker'),read<Record<string,unknown>>('/stats'),Promise.all(batches)]);
  if(!Number.isFinite(Number(ticker.price))||!Number.isFinite(Number(stats.open))||Number(stats.open)<=0)throw new Error('Invalid quote');
  const unique=new Map<number,Candle>();
  for(const rows of raw){if(!Array.isArray(rows))throw new Error('Invalid candles');for(const c of rows){if(!Array.isArray(c)||c.length<6||!c.slice(0,6).every(Number.isFinite)||c[0]*1000<start||c[0]*1000>end)continue;unique.set(c[0],{time:c[0]*1000,low:c[1],high:c[2],open:c[3],close:c[4],volume:c[5]});}}
  let candles=[...unique.values()].sort((a,b)=>a.time-b.time);
  if(!range&&frame==='4h'){const grouped=new Map<number,Candle>();for(const c of candles){const t=Math.floor(c.time/14400000)*14400000,old=grouped.get(t);grouped.set(t,old?{...old,high:Math.max(old.high,c.high),low:Math.min(old.low,c.low),close:c.close,volume:(old.volume??0)+(c.volume??0)}:{...c,time:t});}candles=[...grouped.values()];}
  if(!candles.length)throw new Error('No valid candles');
  const data:MarketData={pair,price:Number(ticker.price),open:Number(stats.open),high:Number(stats.high),low:Number(stats.low),volume:Number(stats.volume),change:(Number(ticker.price)/Number(stats.open)-1)*100,candles,fetchedAt:Date.now(),tradeTime:String(ticker.time??''),source:'Coinbase Exchange'};
  cache.set(key,{expires:Date.now()+60000,data});return Response.json(data,{headers:{'Cache-Control':'private,max-age=30'}});
 }catch{return Response.json({error:'بيانات هذا الأصل غير متاحة الآن.',source:'Coinbase Exchange'},{status:503});}
}

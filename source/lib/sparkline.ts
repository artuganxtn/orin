import type {QuotePoint} from './quote-stream';
type Point={x:number;y:number};
export type SparklineGeometry={path:string;area:string;points:Point[];segments:{start:Point;c1:Point;c2:Point;end:Point}[];last:Point};
/** Shape-preserving interpolation of received prices, with their actual time spacing. */
export function sparklineGeometry(history:readonly QuotePoint[],bounds?:{width:number;height:number;start:number;end:number;min:number;max:number}):SparklineGeometry|null{
 const rows=[...new Map(history.filter(p=>Number.isFinite(p.at)&&Number.isFinite(p.price)&&p.price>0).map(p=>[p.at,p])).values()].sort((a,b)=>a.at-b.at);
 if(rows.length<2)return null;
 const first=bounds?.start??rows[0].at,last=bounds?.end??rows[rows.length-1].at,prices=rows.map(p=>p.price),min=bounds?.min??Math.min(...prices),range=(bounds?.max??Math.max(...prices))-min;
 const width=bounds?.width??160,height=bounds?.height??56;
 const points=rows.map(p=>({x:4+(p.at-first)/(last-first)*(width-8),y:range?height-8-(p.price-min)/range*(height-16):height/2}));
 const widths=points.slice(1).map((p,i)=>p.x-points[i].x),slopes=widths.map((h,i)=>(points[i+1].y-points[i].y)/h);
 const tangents=points.map((_,i)=>{
  if(i===0)return slopes[0];if(i===points.length-1)return slopes[i-1];
  const a=slopes[i-1],b=slopes[i];if(a===0||b===0||Math.sign(a)!==Math.sign(b))return 0;
  const w1=2*widths[i]+widths[i-1],w2=widths[i]+2*widths[i-1];
  return Math.sign(a)*Math.min(Math.abs((w1+w2)/(w1/a+w2/b)),3*Math.min(Math.abs(a),Math.abs(b)));
 });
 const segments=widths.map((h,i)=>({start:points[i],c1:{x:points[i].x+h/3,y:points[i].y+tangents[i]*h/3},c2:{x:points[i+1].x-h/3,y:points[i+1].y-tangents[i+1]*h/3},end:points[i+1]}));
 const xy=(p:Point)=>`${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
 const path=`M ${xy(points[0])} `+segments.map(s=>`C ${xy(s.c1)} ${xy(s.c2)} ${xy(s.end)}`).join(' ');
 return {path,area:path+` L ${points[points.length-1].x.toFixed(2)} ${height-1} L ${points[0].x.toFixed(2)} ${height-1} Z`,points,segments,last:points[points.length-1]};
}
export function sparklinePath(points:readonly QuotePoint[]):string|null{return sparklineGeometry(points)?.path??null}

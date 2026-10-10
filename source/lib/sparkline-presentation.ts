import type {QuoteFeed,QuotePoint} from './quote-stream';
export const SPARKLINE_REFRESH_MS=30000;
export type SparklineFrame={key:string;history:readonly QuotePoint[];previous:readonly QuotePoint[];capturedAt:number};
/** Throttle this decorative view only. QuoteFeed and the displayed live price stay untouched. */
export function advanceSparkline(frame:SparklineFrame|null,feed:QuoteFeed,now:number):SparklineFrame{
 const key=feed.pair+'|'+(feed.data?.source??''),history=feed.history??[];
 const fresh=()=>({key,history:[...history],previous:[] as readonly QuotePoint[],capturedAt:now});
 if(!frame||frame.key!==key)return fresh();
 if(history.length<2)return frame.history.length>=2?fresh():frame;
 if(frame.history.length<2)return fresh();
 if(now-frame.capturedAt<SPARKLINE_REFRESH_MS||history[history.length-1].at<=frame.history[frame.history.length-1].at)return frame;
 return {...fresh(),previous:frame.history};
}

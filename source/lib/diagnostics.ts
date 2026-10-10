/** Bounded, non-identifying diagnostics. Never include tokens, messages or account data. */
type Diagnostic={at:string;area:string;event:string;detail:Record<string,string|number|boolean|null>};
const records:Diagnostic[]=[];
export function diagnostic(area:string,event:string,detail:Diagnostic['detail']={}){
 const entry={at:new Date().toISOString(),area,event,detail};records.push(entry);if(records.length>80)records.shift();
 console.warn('ORIN_DIAGNOSTIC '+JSON.stringify(entry));
}
export function diagnostics(){return records.map(row=>({...row,detail:{...row.detail}}))}

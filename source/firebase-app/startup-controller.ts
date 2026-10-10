/** A bounded, cancellable presentation gate. Never grants access or stores credentials. */
export type StartupState<T> = {phase:'starting'} | {phase:'ready';data:T} | {phase:'error'|'offline';error?:unknown};
export const STARTUP_TIMEOUT_MS=60000;
export interface StartupClock {set:(fn:()=>void,ms:number)=>unknown;clear:(id:unknown)=>void}
const clock:StartupClock={set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id as ReturnType<typeof setTimeout>)};
export function createStartupController<T>(emit:(state:StartupState<T>)=>void,timers:StartupClock=clock){
 let generation=0,active=false,timer:unknown;
 const clear=()=>{if(timer!==undefined)timers.clear(timer);timer=undefined};
 return {
  begin(online=true){clear();const id=++generation;active=online;emit(online?{phase:'starting'}:{phase:'offline'});if(online)timer=timers.set(()=>{if(id!==generation||!active)return;active=false;clear();emit({phase:'error'})},STARTUP_TIMEOUT_MS);
   return {
    current:()=>id===generation&&active,
    ready(data:T){if(id!==generation||!active)return false;active=false;clear();emit({phase:'ready',data});return true},
    fail(error?:unknown,offline=false){if(id!==generation||!active)return;active=false;clear();emit({phase:offline?'offline':'error',error})}
   };
  },
  dispose(){generation++;active=false;clear()}
 };
}

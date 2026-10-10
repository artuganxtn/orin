import type {Preferences} from './preferences';
/** Best effort only: the browser/OS owns permission, vibration and suppression. */
export function haptic(kind:'selection'|'success'|'warning',prefs:Preferences){
 if(!prefs.vibration||prefs.reduceMotion||typeof window==='undefined'||document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches||!('vibrate' in navigator))return;
 navigator.vibrate(kind==='selection'?8:kind==='success'?[12,45,16]:[15,60,15]);
}

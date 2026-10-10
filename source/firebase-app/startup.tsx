import {useUi} from './ui';
export function StartupScreen({state='starting',onRetry}:{state?:'starting'|'error'|'offline';onRetry?:()=>void}){
 const {t}=useUi(),failed=state!=='starting';
 return <main className={'orin-launch'+(failed?' orin-launch-failed':'')} data-startup-state={state} role={failed?'alert':'status'} aria-label={failed?undefined:t('ORIN — بدء التطبيق','ORIN — starting app')}>
  <div className="orin-launch-content"><div className="orin-launch-mark"><img src="/brand/orin-mark.png" alt="" width={112} height={112} fetchPriority="high"/></div><strong className="orin-launch-wordmark" dir="ltr">ORIN</strong>
   {failed&&<section className="orin-launch-message"><h1>{state==='offline'?t('أنت غير متصل','You’re offline'):t('تعذر الاتصال','Unable to connect')}</h1><p>{state==='offline'?t('تحقق من اتصال الإنترنت ثم أعد المحاولة.','Check your internet connection, then try again.'):t('استغرق الاتصال وقتًا أطول من المعتاد. أعد المحاولة للمتابعة.','The connection is taking longer than expected. Try again to continue.')}</p><button type="button" onClick={onRetry??(()=>location.reload())}>{t('إعادة المحاولة','Try again')}<span aria-hidden="true">↻</span></button></section>}
  </div>
 </main>;
}

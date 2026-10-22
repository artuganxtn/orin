import {useContext,useEffect,useState} from 'react';
import {SupportContext} from '../app/support-chat';
import type {SupportMessage} from '../lib/support';
import {Headphones,Send,AlertCircle} from 'lucide-react';

/** Customer-visible messages are separate from Control Center's private ticket notes. */
export function SupportDesk(){
  const service=useContext(SupportContext),
    [threads,setThreads]=useState<{id:string;updatedAt:number;handoffRequested:boolean}[]>([]),
    [selected,setSelected]=useState(''),
    [rows,setRows]=useState<SupportMessage[]>([]),
    [error,setError]=useState(''),
    [draft,setDraft]=useState(''),
    [busy,setBusy]=useState(false);

  useEffect(()=>service?.watchThreads?.(setThreads,()=>setError('تعذر الاتصال بمحادثات العملاء أو لا تتوفر الصلاحية.')),[service]);

  useEffect(()=>{
    setRows([]);
    if(!selected||!service)return;
    return service.watch(selected,s=>setRows(s.messages),state=>{
      if(state==='unavailable')setError('تعذر تحميل المحادثة.');
    });
  },[selected,service]);

  return (
    <section className="support-desk">
      <div className="support-desk-head">
        <div className="support-desk-badge"><Headphones size={15}/> محادثات العملاء المباشرة</div>
        <h2>مركز دعم ومحادثات العملاء</h2>
        <p>الردود المرسلة هنا تظهر في تطبيق العميل مباشرة. الملاحظات الداخلية للفريق لا تُعرض للعميل.</p>
      </div>

      {error && <div className="occ-error" role="alert"><AlertCircle size={15}/> {error}</div>}

      <div className="support-desk-select-wrap">
        <label htmlFor="support-thread-select">اختيار محادثة العميل</label>
        <select id="support-thread-select" value={selected} onChange={e=>{setSelected(e.target.value);setError('');}}>
          <option value="">-- اختر محادثة لمتابعتها والرد --</option>
          {threads.map(row=>(
            <option key={row.id} value={row.id}>
              {row.id.slice(0,12)} · {row.handoffRequested ? '⚡ طلب متابعة' : '💬 محادثة'} · {new Date(row.updatedAt).toLocaleDateString('ar')}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <div className="support-desk-chat-panel">
          <div className="support-messages" role="log">
            {rows.length === 0 ? (
              <p className="occ-muted" style={{textAlign:'center',padding:'24px 0'}}>لا توجد رسائل سابقة في هذه المحادثة.</p>
            ) : (
              rows.map(row=>(
                <article className={'support-bubble '+row.kind} key={row.id}>
                  <header>
                    <b>{row.kind==='customer' ? 'العميل' : row.kind==='assistant' ? 'ORIN AI' : 'موظف الدعم'}</b>
                    <time>{new Date(row.createdAt).toLocaleTimeString('ar', {hour:'2-digit', minute:'2-digit'})}</time>
                  </header>
                  <p>{row.text}</p>
                </article>
              ))
            )}
          </div>

          <form className="support-composer" onSubmit={async e=>{
            e.preventDefault();
            if(!service?.reply||busy||!draft.trim())return;
            setBusy(true);
            setError('');
            try{
              await service.reply(selected,crypto.randomUUID(),draft);
              setDraft('');
            }catch{
              setError('لم يُرسل الرد. تحقق من الاتصال والصلاحيات.');
            }finally{
              setBusy(false);
            }
          }}>
            <textarea
              value={draft}
              onChange={e=>setDraft(e.target.value)}
              maxLength={2000}
              placeholder="اكتب ردك للعميل هنا..."
              aria-label="الرد على العميل"
              rows={3}
            />
            <button className="occ-primary support-send-btn" disabled={busy||!draft.trim()}>
              <Send size={15}/>
              <span>{busy ? 'جارٍ الإرسال…' : 'إرسال الرد للعميل'}</span>
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

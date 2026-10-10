import os

path = r'c:\Users\dipnr\Downloads\ORIN-1.6.2-Full-Developer-Package\source\app\reference-views.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

old_bottom_portal_start = ' <div className="vip-trade-portal">'
old_bottom_portal_end = ' <Dialog open={panel!==null}'

start_idx = text.find(old_bottom_portal_start)
end_idx = text.find(old_bottom_portal_end)
print("Indices:", start_idx, end_idx)
assert start_idx != -1 and end_idx != -1, f"Could not find old bottom portal ({start_idx}, {end_idx})"

# Remove the old bottom portal
text_without_bottom = text[:start_idx] + text[end_idx:]

trade_render_start = ' return <div className="reference-trade"><AssetBackdrop pair={pair}/><div className="trade-titlebar"><button aria-label={t(\'العودة\',\'Back\')} onClick={p.onBack}><ArrowLeft/></button><SymbolSelector onSelect={selectPair} disabled={invited&&!!locked}><CoinIcon symbol={asset}/><span className="num">{symbol.label}</span><ChevronDown size={17}/></SymbolSelector>{enabled&&<button aria-label={t(\'المفضلة\',\'Favorite\')} disabled={busy} aria-pressed={favorites.includes(pair)} className={favorites.includes(pair)?\'selected-star\':\'\'} onClick={()=>toggle(pair)}><Star/></button>}<button aria-label={t(\'تفاصيل العرض\',\'Chart information\')} onClick={()=>setOptions(!options)}><MoreHorizontal/></button></div>'

portal_block = """  <div className="vip-trade-portal vip-portal-top">
   <div className="vip-portal-header">
    <div className="vip-badge-tag"><ShieldCheck size={14} className="gain"/><span>{t('بوابة صفقات التداول العامة المعتمدة بالكود','Universal VIP Trade Signal Portal')}</span></div>
    <p className="vip-portal-hint">{t('عامة لجميع الأصول (BTC, ETH, Gold, Forex...). أدخل كود الصفقة من القناة الخاصة وسيتم تحويل الأصل والدخول تلقائياً.','Universal for all assets (BTC, ETH, Gold, Forex...). Enter any signal code to auto-map the asset and enter trade.')}</p>
   </div>
   <div className="trade-code-card">
    <div className="trade-code-input-row">
     <div className="trade-code-input-wrapper">
      <KeyRound size={17} className="code-icon"/>
      <input id="trade-signal-code" placeholder={t('أدخل كود الصفقة مثال: ORIN-XXXX-XXXX','Enter code e.g. ORIN-XXXX-XXXX')} value={p.code} onChange={e=>p.setCode(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter'&&p.code.trim())p.onExecuteCode?.(p.code,p.amount);}} maxLength={30} autoCapitalize="characters" spellCheck={false}/>
      {p.code&&<button type="button" className="clear-code-btn" onClick={()=>p.setCode('')} title={t('مسح','Clear')}>×</button>}
     </div>
     <button type="button" className="verify-code-btn" onClick={p.lookup} disabled={!p.state||!p.code.trim()||p.busy}>{p.busy?t('جارِ التحقق…','Verifying…'):t('معاينة الشروط','Verify & Load')}</button>
    </div>
    <div className="code-aux-actions">
     <button type="button" className="paste-aux-btn" onClick={async()=>{try{const text=await navigator.clipboard.readText();if(text)p.setCode(text.trim().toUpperCase());}catch{}}}><ClipboardList size={13}/> {t('لصق من الحافظة','Paste from clipboard')}</button>
     <InvitationActions onCode={p.setCode}/>
    </div>
   </div>
   {p.active&&(
    <div className="active-trade-tracker">
     <div className="tracker-top">
      <div className="tracker-status"><span className="live-pulsing-dot"/><strong>{t('الصفقة قيد التنفيذ المباشر','Trade in progress')}</strong></div>
      <div className="tracker-timer"><Timer size={15}/><span className="num">{remaining(p.active.ends_at-p.now)}</span></div>
     </div>
     <div className="tracker-details">
      <div><span>{t('المبلغ المخصص','Allocated Amount')}</span><b className="num">{number(p.active.amount_cents/100)} USD</b></div>
      <div><span>{t('النتيجة المقفلة عند الانتهاء','Expected Return')}</span><b className={`num ${p.active.result_cents>=0?'gain':'loss'}`}>{p.active.result_cents>=0?'+':''}{number(p.active.result_cents/100)} USD</b></div>
     </div>
     <div className="tracker-progress-wrap"><progress value={p.progress} max="1"/></div>
     <p className="tracker-note">{t('التسوية مقفلة رقمياً وتُضاف تلقائياً إلى رصيدك فور اكتمال المؤقت.','Settlement is locked and will be automatically credited to your balance upon timer completion.')}</p>
    </div>
   )}
   {locked&&(
    <div className="verified-signal-card">
     <div className="verified-signal-header">
      <div className="verified-pill"><CheckCircle2 size={14}/><span>{t('صفقة معتمدة وجاهزة للتنفيذ','Verified Signal Ready')}</span></div>
      <span className="mono verified-code-badge">{locked.code}</span>
     </div>
     <div className="verified-signal-grid">
      <div className="signal-cell"><small>{t('الأصل المالي','Asset')}</small><b>{locked.asset}</b></div>
      <div className="signal-cell"><small>{t('اتجاه الصفقة','Direction')}</small><b className={locked.direction==='BUY'?'direction-buy':'direction-sell'}>{locked.direction==='BUY'?t('🟢 شراء BUY','🟢 BUY'):t('🔴 بيع SELL','🔴 SELL')}</b></div>
      <div className="signal-cell"><small>{t('نسبة الربح المقفلة','Locked Return')}</small><b className={`num ${locked.settlement_bps>=0?'gain':'loss'}`}>{percent(locked.settlement_bps)}</b></div>
      <div className="signal-cell"><small>{t('المدة','Duration')}</small><b>{locked.duration_sec/60} {t('دقيقة','min')}</b></div>
     </div>
    </div>
   )}
   <div className="trade-allocation-section">
    <div className="allocation-header"><label htmlFor="trade-amount">{t('مبلغ الدخول في الصفقة','Trade Amount (USD)')}</label><span className="balance-hint">{t('الرصيد المتاح:','Available:')} <b className="num">{number((p.state?.balanceCents??0)/100)} USD</b></span></div>
    <div className="trade-amount">
     <input id="trade-amount" type="number" step="0.01" min="1" value={p.active?(p.active.amount_cents/100):p.amount} onChange={e=>p.setAmount(e.target.value)} disabled={!!p.active}/>
     <button aria-label={t('إعادة تعيين المبلغ','Reset amount')} onClick={()=>p.setAmount('1000')} disabled={!!p.active}><RefreshCw size={16}/></button>
    </div>
    <div className="amount-percent">
     {[25,50,75,100].map(n=><button key={n} disabled={!p.state||!!p.active} onClick={()=>p.setAmount((Math.floor((p.state?.balanceCents??0)*n/100)/100).toFixed(2))}>{n===100?t('الكل 100%','100% All'):`${n}%`}</button>)}
    </div>
   </div>
   <div className="trade-totals">
    <div><span>{t('رسوم التنفيذ','Execution fee')}</span><b className="num">{number(0)} USD</b></div>
    <div><span>{t('المبلغ المخصص','Allocated')}</span><b className="num">{Number.isFinite(Number(p.amount))?number(Number(p.amount)):'—'} USD</b></div>
    {locked&&<div><span>{t('الربح المتوقع','Expected Profit')}</span><b className={`num ${locked.settlement_bps>=0?'gain':'loss'}`}>{Number.isFinite(Number(p.amount))?(locked.settlement_bps>=0?'+':'')+number(Math.round(Number(p.amount)*100*(locked.settlement_bps/10000))/100)+' USD':'—'}</b></div>}
   </div>
   <div className="code-trade-actions">
    {p.active?<button className="btn-primary full active-pending-btn" disabled><Timer size={18}/><span>{t('الصفقة قيد التنفيذ حالياً (مؤقت جارٍ)','Position in progress')}</span></button>:locked&&canJoin?<button className={`btn-primary full code-join-submit-btn ${locked.direction==='BUY'?'btn-buy-accent':'btn-sell-accent'}`} onClick={p.startJoin}><CheckCircle2 size={18}/><span>{t(`تأكيد الدخول في الصفقة المعتمدة (${locked.direction==='BUY'?'شراء BUY':'بيع SELL'})`,`Confirm Entry via Code (${locked.direction})`)}</span></button>:<div className="code-action-dual-buttons"><button type="button" className="btn-primary full enter-auto-btn" disabled={!p.code.trim()||p.busy||!p.state} onClick={()=>p.onExecuteCode?.(p.code,p.amount)}><CheckCircle2 size={18}/><span>{p.busy?t('جارِ التنفيذ التلقائي…','Executing…'):t('دخول الصفقة تلقائياً فوراً','Enter Trade Automatically')}</span></button><button type="button" className="btn-outline full enter-code-hint-btn" disabled={!p.code.trim()||p.busy} onClick={p.lookup}><LockKeyhole size={18}/><span>{p.busy?t('جارِ التحقق…','Verifying…'):t('معاينة الشروط والأصل','Review Terms & Asset')}</span></button></div>}
   </div>
   <p className="trade-disclosure">{t('🔒 صفقات التداول معتمدة ومقفلة الشروط مسبقاً وفق الكود الصادر من الإدارة، والتسوية تتم آلياً ومستقلة عن تقلبات السوق العشوائية.','🔒 Official signals have pre-locked terms. Settlement is automated and follows contract terms.')}</p>
  </div>"""

assert trade_render_start in text_without_bottom, "trade_render_start not found in text_without_bottom"
new_text = text_without_bottom.replace(trade_render_start, trade_render_start + '\n' + portal_block)

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_text)

print("Successfully moved portal to the top of ReferenceTrade!")

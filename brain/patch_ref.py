import os

path = r'c:\Users\dipnr\Downloads\ORIN-1.6.2-Full-Developer-Package\source\app\reference-views.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Replace CoinIcon definition with import
old_coin = """const coins=[['BTC','₿','#ff9419'],['ETH','Ξ','#4669aa'],['XRP','×','#111622'],['SOL','≋','#1b2136'],['BNB','◇','#f3b310'],['DOGE','Ð','#c7aa4e'],['TON','▽','#21a6df'],['ADA','⁙','#155ace']];
const remaining=(ms:number)=>`${String(Math.floor(Math.max(0,ms)/60000)).padStart(2,'0')}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
export function CoinIcon({symbol}:{symbol:string}){const found=coins.find(c=>c[0]===symbol);return <span className="coin-logo" style={{background:found?.[2]??'#d7aa43'}} aria-hidden="true">{found?.[1]??(symbol==='XAU'?'Au':symbol.slice(0,1))}</span>}"""

new_coin = """import {CoinIcon, AssetIcon} from './asset-icons';
export {CoinIcon, AssetIcon};
const remaining=(ms:number)=>`${String(Math.floor(Math.max(0,ms)/60000)).padStart(2,'0')}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;"""

assert old_coin in text, "old_coin snippet not found"
text = text.replace(old_coin, new_coin)
print("Replaced CoinIcon definition!")

# 2. Check ReferenceHome signature
old_home_sig = """export function ReferenceHome({state,prefs,selectedPair,onPairChange,onHideBalance,onNavigate,onInvite,onFunding,onTerms,onAccountsChange,onTransfer}:{state:LabState|null;prefs:Preferences;selectedPair?:string;onPairChange?:(pair:string)=>void;onHideBalance:()=>void;onNavigate:(tab:string)=>void;onInvite:()=>void;onFunding:(kind:'deposit'|'withdraw')=>void;onTerms:()=>void;onTransfer?:()=>void;onAccountsChange?:(directory:AccountDirectory,phase?:'optimistic'|'confirmed'|'rollback')=>void}){"""

new_home_sig = """export function ReferenceHome({state,prefs,selectedPair,onPairChange,onHideBalance,onNavigate,onInvite,onFunding,onTerms,onAccountsChange,onTransfer,code='',setCode,amount='1000',setAmount,onExecuteCode,onLookupCode,busy=false,activePosition,now=Date.now(),progress=0}:{state:LabState|null;prefs:Preferences;selectedPair?:string;onPairChange?:(pair:string)=>void;onHideBalance:()=>void;onNavigate:(tab:string)=>void;onInvite:()=>void;onFunding:(kind:'deposit'|'withdraw')=>void;onTerms:()=>void;onTransfer?:()=>void;onAccountsChange?:(directory:AccountDirectory,phase?:'optimistic'|'confirmed'|'rollback')=>void;code?:string;setCode?:(s:string)=>void;amount?:string;setAmount?:(s:string)=>void;onExecuteCode?:(code:string,amount?:string)=>void;onLookupCode?:(code:string)=>void;busy?:boolean;activePosition?:Position;now?:number;progress?:number}){"""

assert old_home_sig in text, "old_home_sig not found"
text = text.replace(old_home_sig, new_home_sig)
print("Updated ReferenceHome signature!")

# 3. Add home VIP portal right after quick actions
old_quick = """<div className="quick-actions"><button disabled={isDemo||!account} title={isDemo?t('الإيداع للحساب الحقيقي فقط','Real accounts only'):undefined} onClick={()=>onFunding('deposit')}><span><Wallet/></span>{t('إيداع','Deposit')}</button><button disabled={isDemo||!account} title={isDemo?t('الرصيد التجريبي غير قابل للسحب','Demo funds cannot be withdrawn'):undefined} onClick={()=>onFunding('withdraw')}><span><ArrowUpFromLine/></span>{t('سحب','Withdraw')}</button><button onClick={onTransfer}><span><ArrowLeftRight/></span>{t('تحويل','Transfer')}</button><button onClick={onInvite}><span><Users/></span>{t('دعوة صديق','Invite a friend')}</button></div>
  {isDemo&&account&&<DemoBalanceDialog key={account.id} account={account} open={adjustOpen} onOpenChange={setAdjustOpen} onSaved={reloadAccounts}/>}"""

home_portal = """<div className="quick-actions"><button disabled={isDemo||!account} title={isDemo?t('الإيداع للحساب الحقيقي فقط','Real accounts only'):undefined} onClick={()=>onFunding('deposit')}><span><Wallet/></span>{t('إيداع','Deposit')}</button><button disabled={isDemo||!account} title={isDemo?t('الرصيد التجريبي غير قابل للسحب','Demo funds cannot be withdrawn'):undefined} onClick={()=>onFunding('withdraw')}><span><ArrowUpFromLine/></span>{t('سحب','Withdraw')}</button><button onClick={onTransfer}><span><ArrowLeftRight/></span>{t('تحويل','Transfer')}</button><button onClick={onInvite}><span><Users/></span>{t('دعوة صديق','Invite a friend')}</button></div>
  {isDemo&&account&&<DemoBalanceDialog key={account.id} account={account} open={adjustOpen} onOpenChange={setAdjustOpen} onSaved={reloadAccounts}/>}
  {activePosition&&(
   <div className="home-active-trade-card">
    <div className="home-active-top">
     <div className="live-status-pill"><span className="live-pulsing-dot"/><b>{t('صفقة تداول قيد التنفيذ الآن','Trade Active & In Progress')}</b></div>
     <div className="live-timer-badge"><Timer size={14}/><span className="num">{remaining(activePosition.ends_at-now)}</span></div>
    </div>
    <div className="home-active-meta">
     <div className="active-asset-tag"><CoinIcon symbol={activePosition.contract.asset} size={24}/><span><b>{activePosition.contract.asset}</b> · <small className={activePosition.contract.direction==='BUY'?'gain':'loss'}>{activePosition.contract.direction}</small></span></div>
     <div className="active-return-tag"><span>{t('الربح المقفل:','Locked Return:')}</span><strong className={`num ${activePosition.result_cents>=0?'gain':'loss'}`}>{activePosition.result_cents>=0?'+':''}{number(activePosition.result_cents/100)} USD</strong></div>
    </div>
    <div className="tracker-progress-wrap"><progress value={progress} max="1"/></div>
    <button className="btn-view-active-trade" onClick={()=>onNavigate('demo')}>{t('متابعة تفاصيل الصفقة والشارت المباشر','View Trade & Live Chart')} <ArrowLeft size={15}/></button>
   </div>
  )}
  <section className="home-vip-code-card">
   <div className="home-vip-header">
    <div className="home-vip-title">
     <span className="home-vip-icon-badge"><KeyRound size={20}/></span>
     <div>
      <h3>{t('بوابة صفقات التداول المعتمدة بالكود','VIP Authorized Trade Signal Portal')}</h3>
      <span className="home-vip-badge">{t('كود عام لكافة الأصول (BTC, ETH, Gold, Forex...)','Universal: BTC, ETH, Gold, Forex...')}</span>
     </div>
    </div>
   </div>
   <p className="home-vip-desc">{t('لا حاجة لاختيار أصل أو فتح شارت مسبقاً. أدخل كود الصفقة من القناة الخاصة وسيقوم النظام بتوجيه الأصل والدخول تلقائياً.','No need to select an asset or open its chart. Enter your signal code to automatically map the asset and execute.')}</p>
   <div className="home-code-input-row">
    <div className="home-code-input-wrap">
     <KeyRound size={17} className="code-input-ico"/>
     <input id="home-trade-signal-code" placeholder={t('أدخل كود الصفقة مثال: ORIN-XXXX-XXXX','Enter code e.g. ORIN-XXXX-XXXX')} value={code} onChange={e=>setCode?.(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter'&&code.trim())onExecuteCode?.(code,amount);}} maxLength={30} autoCapitalize="characters" spellCheck={false}/>
     {code&&<button type="button" className="clear-code-btn" onClick={()=>setCode?.('')} title={t('مسح','Clear')}>×</button>}
    </div>
    <button type="button" className="btn-paste-code" onClick={async()=>{try{const text=await navigator.clipboard.readText();if(text)setCode?.(text.trim().toUpperCase());}catch{}}} title={t('لصق من الحافظة','Paste from clipboard')}><ClipboardList size={14}/> {t('لصق','Paste')}</button>
   </div>
   <div className="home-amount-quick-row">
    <div className="home-amount-input-wrap">
     <span className="home-amount-currency">$</span>
     <input type="number" min="1" step="10" value={amount} onChange={e=>setAmount?.(e.target.value)} placeholder="1000" aria-label={t('مبلغ التداول','Trade amount')}/>
     <span className="home-amount-unit">USD</span>
    </div>
    <div className="home-amount-presets">
     {['250','500','1000','2500'].map(val=><button key={val} type="button" className={amount===val?'preset-active':''} onClick={()=>setAmount?.(val)}>${val}</button>)}
    </div>
   </div>
   <div className="home-vip-action-row">
    <button type="button" className="btn-execute-auto" disabled={busy||!code.trim()||!state} onClick={()=>onExecuteCode?.(code,amount)}><CheckCircle2 size={18}/><span>{busy?t('جارِ التنفيذ والدخول…','Executing trade…'):t('دخول الصفقة تلقائياً فوراً','Enter Trade Automatically')}</span></button>
    <button type="button" className="btn-review-terms" disabled={busy||!code.trim()||!state} onClick={()=>onLookupCode?.(code)}>{t('معاينة الشروط','Review Terms')}</button>
   </div>
  </section>"""

assert old_quick in text, "old_quick not found"
text = text.replace(old_quick, home_portal)
print("Added home VIP code card!")

# 4. Update TradeProps
old_trade_props = """interface TradeProps{state:LabState|null;current:Contract;selected:Contract|null;active?:Position;now:number;progress:number;code:string;setCode:(s:string)=>void;amount:string;setAmount:(s:string)=>void;lookup:()=>void;startJoin:()=>void;onBack:()=>void;onNotifications:()=>void;referencePair:string;setReferencePair:(s:string)=>void;mode:string;setMode:(s:string)=>void;busy:boolean;onAsset:(asset:Asset)=>void;prefs:Preferences;}"""

new_trade_props = """interface TradeProps{state:LabState|null;current:Contract;selected:Contract|null;active?:Position;now:number;progress:number;code:string;setCode:(s:string)=>void;amount:string;setAmount:(s:string)=>void;lookup:()=>void;onExecuteCode?:(code:string,amount?:string)=>void;startJoin:()=>void;onBack:()=>void;onNotifications:()=>void;referencePair:string;setReferencePair:(s:string)=>void;mode:string;setMode:(s:string)=>void;busy:boolean;onAsset:(asset:Asset)=>void;prefs:Preferences;}"""

assert old_trade_props in text, "old_trade_props not found"
text = text.replace(old_trade_props, new_trade_props)
print("Updated TradeProps!")

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print("Saved reference-views.tsx successfully!")

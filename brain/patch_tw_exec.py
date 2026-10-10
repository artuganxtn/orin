import os

path = r'c:\Users\dipnr\Downloads\ORIN-1.6.2-Full-Developer-Package\source\app\trading-workspace.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

old_lookup = """ const lookup=async()=>{if(busy)return;setBusy(true);try{const response=await apiFetch('/api/invitations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.trim().toUpperCase()})}),data=await response.json() as {contract:Contract;serverTime:number;error?:string};if(!response.ok)throw new Error(data.error??t('تعذر التحقق من الدعوة','Unable to verify invitation'));setOffset(data.serverTime-Date.now());chooseContract(data.contract);navigation.navigate('/contracts/'+data.contract.id);setDetailsOpen(true);}catch(e){toast.error(e instanceof Error?e.message:t('تعذر التحقق من الدعوة','Unable to verify invitation'));}finally{setBusy(false);}};"""

new_lookup_and_execute = """ const lookup=async(overrideCode?:string)=>{const cStr=(overrideCode??code).trim().toUpperCase();if(busy||!cStr)return;setBusy(true);try{const response=await apiFetch('/api/invitations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cStr})}),data=await response.json() as {contract:Contract;serverTime:number;error?:string};if(!response.ok)throw new Error(data.error??t('تعذر التحقق من الدعوة','Unable to verify invitation'));setOffset(data.serverTime-Date.now());chooseContract(data.contract);let newPair=data.contract.asset;if(!newPair.includes('-')){if(newPair==='BNB')newPair='BNB-USDT';else if(newPair==='TON')newPair='TON-USDT';else newPair=`${newPair}-USD`;}if(MARKET_SYMBOLS.some(s=>s.pair===newPair)){setDetailPair(newPair);setMarketPair(newPair);setHomePair(newPair);void updatePreferences({chartPair:newPair});}setTab('demo');navigation.navigate('/contracts/'+data.contract.id);setDetailsOpen(true);}catch(e){toast.error(e instanceof Error?e.message:t('تعذر التحقق من الدعوة','Unable to verify invitation'));}finally{setBusy(false);}};
 const executeCode=async(providedCode?:string,targetAmount?:string)=>{const cStr=(providedCode??code).trim().toUpperCase();if(!cStr){toast.error(t('يرجى إدخال كود الصفقة أولاً','Please enter a trade signal code first'));return;}if(busy)return;setBusy(true);try{const response=await apiFetch('/api/invitations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cStr})}),data=await response.json() as {contract:Contract;serverTime:number;error?:string};if(!response.ok)throw new Error(data.error??t('تعذر التحقق من كود الصفقة','Unable to verify signal code'));setOffset(data.serverTime-Date.now());const c=data.contract;setResolvedContract(c);setSelectedId(c.id);setCode(c.code);setAsset(c.asset);setOrderMode('invited');let newPair=c.asset;if(!newPair.includes('-')){if(newPair==='BNB')newPair='BNB-USDT';else if(newPair==='TON')newPair='TON-USDT';else newPair=`${newPair}-USD`;}if(MARKET_SYMBOLS.some(s=>s.pair===newPair)){setDetailPair(newPair);setMarketPair(newPair);setHomePair(newPair);void updatePreferences({chartPair:newPair});}if(!state?.user.accepted_at){setTab('demo');setTermsOpen(true);toast.info(t('يرجى قبول الشروط لتفعيل أول صفقة','Please accept terms to activate trading'));return;}const rawAmt=targetAmount??amount;let val=Number(rawAmt);if(!Number.isFinite(val)||val<1){val=1000;setAmount('1000');}const balCents=state?.balanceCents??0;if(balCents>0&&Math.round(val*100)>balCents){val=Math.max(1,Math.floor(balCents/100));setAmount(String(val));}await mutate({action:'join',code:c.code,amountCents:Math.round(val*100),contractHash:c.hash,confirmed:true});haptic('success',prefs);setTab('demo');navigation.navigate('/contracts/'+c.id+'/success');toast.success(t(`🚀 تم دخول الصفقة (${c.asset} ${c.direction}) وتفعيل المؤقت بنجاح!`,`🚀 Trade (${c.asset} ${c.direction}) executed successfully!`));}catch(e){toast.error(e instanceof Error?e.message:t('تعذر تنفيذ الصفقة','Unable to execute trade'));setTab('demo');}finally{setBusy(false);}};"""

assert old_lookup in text, "old_lookup not found"
text = text.replace(old_lookup, new_lookup_and_execute)
print("Updated lookup and added executeCode!")

old_tabs_home = """<TabsContent value="home"><ReferenceHome state={state} prefs={prefs} selectedPair={homePair} onPairChange={setHomePair} onAccountsChange={accountsChanged} onTransfer={()=>navigation.navigate('/transfer')} onHideBalance={()=>updatePreferences({hideBalance:!prefs.hideBalance})} onNavigate={v=>{if(v==='demo')setOrderMode('invited');setTab(v);}} onInvite={()=>navigation.navigate('/referral')} onFunding={kind=>navigation.navigate(kind==='deposit'?'/deposit':'/withdraw')} onTerms={()=>setTermsOpen(true)}/></TabsContent>"""

new_tabs_home = """<TabsContent value="home"><ReferenceHome state={state} prefs={prefs} selectedPair={homePair} onPairChange={setHomePair} onAccountsChange={accountsChanged} onTransfer={()=>navigation.navigate('/transfer')} onHideBalance={()=>updatePreferences({hideBalance:!prefs.hideBalance})} onNavigate={v=>{if(v==='demo')setOrderMode('invited');setTab(v);}} onInvite={()=>navigation.navigate('/referral')} onFunding={kind=>navigation.navigate(kind==='deposit'?'/deposit':'/withdraw')} onTerms={()=>setTermsOpen(true)} code={code} setCode={setCode} amount={amount} setAmount={setAmount} onExecuteCode={(c,a)=>void executeCode(c,a)} onLookupCode={c=>{if(c)setCode(c);void lookup(c);}} busy={busy} activePosition={active} now={now} progress={progress}/></TabsContent>"""

assert old_tabs_home in text, "old_tabs_home not found"
text = text.replace(old_tabs_home, new_tabs_home)
print("Updated TabsContent home with VIP code portal props!")

old_ref_trade = """lookup={lookup} startJoin={startJoin}"""
new_ref_trade = """lookup={lookup} onExecuteCode={(c,a)=>void executeCode(c,a)} startJoin={startJoin}"""
assert old_ref_trade in text, "old_ref_trade not found"
text = text.replace(old_ref_trade, new_ref_trade)
print("Updated ReferenceTrade with onExecuteCode prop!")

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print("Saved trading-workspace.tsx successfully!")

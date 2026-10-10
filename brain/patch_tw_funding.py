import os

path = r'c:\Users\dipnr\Downloads\ORIN-1.6.2-Full-Developer-Package\source\app\trading-workspace.tsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'const receive=useCallback' in line:
        print(f"Found receive at line {i+1}")
        lines[i] = """ const receive=useCallback((data:LabState,seq:number)=>{
  if(seq<applied.current||selectionPending.current)return;
  applied.current=seq;
  let finalData=data;
  if(data.accountDirectory?.accounts?.length){
    const real=data.accountDirectory.accounts.find(a=>a.type==='real');
    const cur=data.accountDirectory.accounts.find(a=>a.id===data.accountDirectory.activeId);
    if(real&&(!cur||cur.type==='demo'||data.accountDirectory.activeId==='primary')){
      finalData=scopeAccountState(data,{...data.accountDirectory,activeId:real.id});
    }
  }
  setState(finalData);stateRef.current=finalData;setOffset(finalData.serverTime-Date.now());setError('');setSyncError('');setAuthNeeded(false);
  if(lastNotice.current!==null){const fresh=finalData.notifications.filter(n=>n.created_at>lastNotice.current!);if(fresh.length&&prefsRef.current.notifications)toast.info(displayText(fresh[0].title),{description:displayText(fresh[0].message)});}
  lastNotice.current=Math.max(lastNotice.current??0,...finalData.notifications.map(n=>n.created_at));
 },[]);
"""
    elif '<Dialog open={!!funding}' in line:
        print(f"Found funding dialog at line {i+1}")
        lines[i] = """  <Dialog open={!!funding} onOpenChange={v=>{if(!v)setFunding(null);}}><DialogContent className="popup"><DialogHeader><DialogTitle>{funding}</DialogTitle><DialogDescription>{(activeTradingAccount(state?.accountDirectory)?.type==='real'?t('حساب حقيقي · USD','Real account · USD'):t('حساب تجريبي · USD','Demo account · USD'))}</DialogDescription></DialogHeader>{funding&&<FundingPanel key={((activeTradingAccount(state?.accountDirectory)?.type==='real'?activeTradingAccount(state?.accountDirectory):state?.accountDirectory?.accounts.find(a=>a.type==='real'))?.id??'none')+':'+funding} account={(activeTradingAccount(state?.accountDirectory)?.type==='real'?activeTradingAccount(state?.accountDirectory):state?.accountDirectory?.accounts.find(a=>a.type==='real'))??activeTradingAccount(state?.accountDirectory)} kind={funding==='إيداع'?'deposit':'withdraw'} onBalanceChange={()=>void refresh()}/>}</DialogContent></Dialog>
"""

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Saved trading-workspace.tsx successfully!")

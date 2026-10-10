import os

path = r'c:\Users\dipnr\Downloads\ORIN-1.6.2-Full-Developer-Package\source\app\reference-views.tsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'className="quick-actions"' in line:
        print(f"Found quick-actions at line {i+1}")
        lines[i] = """  <div className="quick-actions">
    <button type="button" onClick={()=>{
      const realAcc = state?.accountDirectory?.accounts.find(a=>a.type==='real');
      if(realAcc && state?.accountDirectory && state.accountDirectory.activeId !== realAcc.id){
        onAccountsChange?.({...state.accountDirectory, activeId: realAcc.id}, 'confirmed');
      }
      onFunding('deposit');
    }}><span><Wallet/></span>{t('إيداع','Deposit')}</button>
    <button type="button" onClick={()=>{
      const realAcc = state?.accountDirectory?.accounts.find(a=>a.type==='real');
      if(realAcc && state?.accountDirectory && state.accountDirectory.activeId !== realAcc.id){
        onAccountsChange?.({...state.accountDirectory, activeId: realAcc.id}, 'confirmed');
      }
      onFunding('withdraw');
    }}><span><ArrowUpFromLine/></span>{t('سحب','Withdraw')}</button>
    <button type="button" onClick={onTransfer}><span><ArrowLeftRight/></span>{t('تحويل','Transfer')}</button>
    <button type="button" onClick={onInvite}><span><Users/></span>{t('دعوة صديق','Invite a friend')}</button>
  </div>
"""
        break

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Saved reference-views.tsx successfully!")

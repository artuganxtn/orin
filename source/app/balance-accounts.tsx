'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Popover} from 'radix-ui';
import {Check, ChevronDown, Eye, EyeOff, Coins, Plus, X, Settings2} from 'lucide-react';
import {apiFetch} from '@/lib/client-api';
import type {LabState} from '@/lib/contracts';
import {activeTradingAccount, maskedAccountNumber, type AccountDirectory, type TradingAccountType} from '@/lib/trading-accounts';
import {useOrin} from './orin-settings';
import './balance-accounts.css';

type Props = {state: LabState | null; onHideBalance: () => void; onTerms: () => void; onAdjustDemo?:()=>void; onDirectoryChange?: (directory: AccountDirectory,phase?:'optimistic'|'confirmed'|'rollback') => void};
async function requestAccounts(method = 'GET', input?: object): Promise<AccountDirectory> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      apiFetch('/api/trading-accounts', input ? {method, headers: {'Content-Type':'application/json'}, body:JSON.stringify(input)} : {}),
      new Promise<Response>((_, reject) => {timer = setTimeout(() => reject(new Error('انتهت مهلة الاتصال. أعد المحاولة؛ لن يتكرر إنشاء الحساب. / Connection timed out. Retry safely.')), 18000);})
    ]);
    const data = await response.json() as AccountDirectory & {error?:string};
    if (!response.ok) throw new Error(response.status === 403 ? 'ميزة الحسابات غير متاحة بعد لهذا المستخدم. / Accounts are not available for this user yet.' : data.error);
    return data as AccountDirectory;
  } finally {if(timer) clearTimeout(timer);}
}

export function BalanceAccounts({state, onHideBalance, onDirectoryChange, onAdjustDemo}: Props) {
  const {prefs,t,number} = useOrin();
  const [directory,setDirectory] = useState<AccountDirectory | null>(state?.accountDirectory ?? null);
  const [open,setOpen] = useState(false), [creating,setCreating] = useState(false);
  const [kind,setKind] = useState<TradingAccountType>('real'), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const ticket=useRef(0), busyRef=useRef(false), requestId=useRef<string | null>(null);
  const onChange=useRef(onDirectoryChange);onChange.current=onDirectoryChange;
  const active=activeTradingAccount(directory), uid=state?.user.id;
  const label=(type: TradingAccountType) => type === 'real' ? t('حساب حقيقي','Real account') : t('حساب تجريبي','Demo account');
  const save = useCallback((next: AccountDirectory,phase:'optimistic'|'confirmed'|'rollback'='confirmed') => {
    let effective = next;
    const real = next.accounts.find(a=>a.type==='real');
    const cur = next.accounts.find(a=>a.id===next.activeId);
    if(real && (!cur || cur.type==='demo' || next.activeId==='primary')){
      effective = {...next, activeId: real.id};
    }
    setDirectory(effective);
    onChange.current?.(effective,phase);
  },[]);
  const run = useCallback(async (method='GET', input?: object) => {
    if(busyRef.current) return null;
    busyRef.current=true;setBusy(true);setError('');const current=++ticket.current;
    try {const next=await requestAccounts(method,input);if(current!==ticket.current)return null;save(next);return next;}
    catch(e){if(current===ticket.current)setError(e instanceof Error?e.message:'تعذر تحميل الحسابات. / Accounts unavailable.');return null;}
    finally {if(current===ticket.current){busyRef.current=false;setBusy(false);}}
  },[save]);
  useEffect(()=>{
    if(state?.accountDirectory){
      let effective = state.accountDirectory;
      const real = effective.accounts.find(a=>a.type==='real');
      const cur = effective.accounts.find(a=>a.id===effective.activeId);
      if(real && (!cur || cur.type==='demo' || effective.activeId==='primary')){
        effective = {...effective, activeId: real.id};
      }
      setDirectory(effective);
    }
  },[state?.accountDirectory]);
  useEffect(()=>{
    if(uid)void run();
    return()=>{ticket.current++;busyRef.current=false;};
  },[uid,run]);
  const openList=(value:boolean)=>{setOpen(value);if(value){setCreating(false);void run();}};
  const balance=active ? active.balanceCents+active.reservedCents : state ? state.balanceCents+state.reservedCents : null;
  const realized=active?.realizedCents ?? state?.realizedCents;
  const now = state?.serverTime ?? Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const positions24h = (state?.positions ?? []).filter(p => {
    if (p.status !== 'settled') return false;
    if (active && (p as any).account_id && (p as any).account_id !== active.id) return false;
    const time = Number(p.settled_at ?? p.ends_at ?? p.started_at ?? 0);
    return time >= dayAgo;
  });
  const positions24hCents = positions24h.reduce((sum, p) => sum + (Number(p.result_cents) || 0), 0);
  const backendDaily = active?.dailyProfitCents !== undefined
    ? Number(active.dailyProfitCents)
    : state?.dailyProfitCents !== undefined
    ? Number(state.dailyProfitCents)
    : undefined;
  const profit24h = backendDaily !== undefined ? backendDaily : positions24hCents;
  const create=async()=>{
    if(!requestId.current)requestId.current=crypto.randomUUID();
    const next=await run('POST',{id:requestId.current,type:'real'});
    if(next){requestId.current=null;setCreating(false);}
  };
  const select=async(id:string)=>{if(!directory||busyRef.current)return;if(directory.activeId===id){setOpen(false);return;}const previous=directory;save({...directory,activeId:id},'optimistic');setOpen(false);if(!await run('PATCH',{id})){save(previous,'rollback');setOpen(true)}};
  const available=active?.balanceCents ?? state?.balanceCents;
  return <section className="balance-hero balance-hero-v3">
    <img src="/brand/orin-mark.png" alt=""/>
    <Popover.Root open={open} onOpenChange={openList} modal>
      <Popover.Trigger asChild><button type="button" className="orin-account-strip" disabled={!uid} aria-label={t('اختيار الحساب','Select account')}>
        {active?<><span className="account-strip-copy"><b><span className="account-mode-badge real">{t('حقيقي','Real')}</span></b><small><bdi>{active.currency}</bdi> <bdi className="num">{maskedAccountNumber(active.accountNumber)}</bdi></small></span></>:<span>{t('الحسابات','Accounts')}</span>}
        <ChevronDown size={15} aria-hidden="true"/>
      </button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="orin-accounts-menu" side="bottom" align="start" sideOffset={6} collisionPadding={12} dir={prefs.chartLocale==='ar'?'rtl':'ltr'} aria-label={t('حساباتي','My accounts')}>
        <div className="orin-accounts-heading"><strong>{t('حساباتي','My accounts')}</strong><Popover.Close className="orin-accounts-close" aria-label={t('إغلاق','Close')}><X size={18}/></Popover.Close></div>
        <div className="orin-accounts-list" role="group" aria-label={t('اختيار الحساب النشط','Choose active account')} aria-busy={busy}>
          {directory?.accounts.map(account=><button className="orin-account-option" type="button" aria-pressed={directory.activeId===account.id} key={account.id} disabled={busy} onClick={()=>void select(account.id)}>
            <span className="orin-account-check" aria-hidden="true">{directory.activeId===account.id&&<Check size={18}/>}</span>
            <span className="orin-account-identity"><b>{t('حساب حقيقي','Real account')}</b><bdi className="num">{account.accountNumber} · {account.currency}</bdi></span>
            <bdi className="orin-account-amount num">{prefs.hideBalance?'••••••':`${number((account.balanceCents+account.reservedCents)/100)} ${account.currency}`}</bdi>
          </button>)}
        </div>
        {error&&<div className="orin-account-error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={()=>void run()}>{t('إعادة تحميل الحسابات','Reload accounts')}</button></div>}
        {busy&&<p className="orin-account-status" role="status">{t('جار حفظ الحسابات أو تحديثها…','Saving or updating accounts…')}</p>}
        {!creating?<button type="button" className="orin-account-add" disabled={busy||!directory} onClick={()=>{setCreating(true);setError('');}}><Plus size={17}/>{t('إنشاء حساب جديد','Create new account')}</button>:<form className="orin-account-create" onSubmit={e=>{e.preventDefault();void create();}}>
          <fieldset disabled={busy}><legend>{t('نوع الحساب الجديد','New account type')}</legend>
            <label><input type="radio" name="orin-new-account-kind" value="real" checked readOnly/>{t('حساب حقيقي (USD)','Real account (USD)')}</label>
          </fieldset>
          <div className="orin-account-create-actions"><button type="submit" disabled={busy}>{t('إنشاء الحساب','Create account')}</button><button type="button" disabled={busy} onClick={()=>setCreating(false)}>{t('إلغاء','Cancel')}</button></div>
        </form>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <div className="balance-top"><span>{t('إجمالي الرصيد','Total balance')}</span><button aria-label={prefs.hideBalance?t('إظهار الرصيد','Show balance'):t('إخفاء الرصيد','Hide balance')} onClick={onHideBalance}>{prefs.hideBalance?<EyeOff/>:<Eye/>}</button></div>
    <strong className="balance-total num">{prefs.hideBalance?'••••••':balance===null?'$ —':`$${number(balance/100)}`}</strong>
    <div className="balance-bottom"><span className={`num ${(profit24h??0)<0?'loss':'gain'}`}>{prefs.hideBalance?'••••':profit24h===undefined?'—':`${profit24h>=0?'+':''}${number(profit24h/100)} USD`}</span><small>{t('أرباح 24 ساعة','24h profit')}</small></div>
    <div className="balance-brand-caption" aria-hidden="true">Trade Beyond Limits</div>
    <div className="balance-available"><Coins size={23}/><span><small>{t('الرصيد المتاح','Available balance')}</small><bdi className="num">{prefs.hideBalance?'••••••':available===undefined?'$ —':`$${number(available/100)}`}</bdi></span></div>
  </section>;
}

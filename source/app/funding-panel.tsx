'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Copy, LockKeyhole, RefreshCw, Clock3, Info, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ScanLine, Wallet, MessageCircleMore, ArrowDownLeft, ArrowUpRight, Check, CircleCheck, CircleAlert, CheckCircle2 } from 'lucide-react';
import { createDeposit, listDeposits, paymentReadiness, refreshDeposit } from '@/lib/payment-client';
import { apiFetch } from '@/lib/client-api';
import { PAYMENT_COINS, type PaymentCoin, type PaymentReadiness, type DepositView, type DepositStatus } from '@/lib/payments';
import type { TradingAccount } from '@/lib/trading-accounts';
import { demoWalletRequest } from '@/lib/demo-wallet-client';
import type { DemoWalletView } from '@/lib/demo-wallet';
import { isNewDepositAmount } from '@/lib/financial-policy';
import { useOrin } from './orin-settings';
import { useNavigation } from './orin-navigation';
import { WithdrawalReceiptView } from './withdrawal-receipt';
import './funding-panel.css';

const statuses: Record<DepositStatus, [string, string]> = {
  creating: ['جار إنشاء طلب الدفع', 'Creating payment'],
  waiting: ['بانتظار التحويل', 'Awaiting transfer'],
  confirming: ['جار تأكيد الشبكة', 'Network confirmation'],
  confirmed: ['تأكد التحويل؛ جار المعالجة', 'Confirmed; processing'],
  sending: ['جار التسوية', 'Settling'],
  finished: ['اكتمل الدفع', 'Payment completed'],
  partially_paid: ['وصل مبلغ جزئي', 'Partially paid'],
  failed: ['فشل الدفع', 'Payment failed'],
  refunded: ['أُعيد المبلغ', 'Refunded'],
  expired: ['انتهت صلاحية الطلب', 'Payment expired'],
  review: ['قيد المراجعة', 'Payment under review']
};

const tone = (s: DepositStatus, credited = false) => credited || s === 'finished' ? 'ok' : ['failed', 'expired', 'refunded'].includes(s) ? 'bad' : 'wait';
const COIN_NAMES: Record<string, string> = { USDT: 'Tether', BTC: 'Bitcoin', ETH: 'Ethereum' };
const splitNetwork = (network: string, label: string) => { const [name, std] = network.split(' · '); return [name, std ?? label] as const; };

function Mark({ kind, size = 32 }: { kind: string; size?: number }) {
  const s = { width: size, height: size };
  if (kind === 'usdttrc20' || kind === 'TRON' || kind === 'trc20') {
    return (
      <span className="fp-mark" style={{ ...s, background: '#e02020', borderRadius: '50%' }}>
        <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round">
          <path d="M3.5 4.5 20 7.6 11.2 20.5Z" />
          <path d="M3.5 4.5 11.2 20.5 13 9.6 20 7.6M13 9.6 3.5 4.5" />
        </svg>
      </span>
    );
  }
  if (kind === 'usdtbsc' || kind === 'bsc' || kind === 'bep20') {
    return (
      <span className="fp-mark" style={{ ...s, background: '#f3ba2f', borderRadius: '50%' }}>
        <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="#fff">
          <path d="M12 3.2 14.6 5.8 12 8.4 9.4 5.8ZM6.3 8.9 8.9 11.5 6.3 14.1 3.7 11.5ZM17.7 8.9 20.3 11.5 17.7 14.1 15.1 11.5ZM12 9.1 14.6 11.7 12 14.3 9.4 11.7ZM12 14.9 14.6 17.5 12 20.1 9.4 17.5Z" />
        </svg>
      </span>
    );
  }
  if (kind === 'eth' || kind === 'ETH' || kind === 'erc20') {
    return (
      <span className="fp-mark" style={{ ...s, background: '#627eea', borderRadius: '50%' }}>
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55}>
          <path d="M12 2 5.8 12.2 12 15.9l6.2-3.7Z" fill="#fff" />
          <path d="M12 17.1 5.8 13.4 12 22l6.2-8.6Z" fill="#c0ccf8" />
        </svg>
      </span>
    );
  }
  if (kind === 'btc' || kind === 'BTC') return <span className="fp-mark" style={{ ...s, background: '#f7931a', borderRadius: '50%', color: '#fff', fontSize: size * 0.5 }}>₿</span>;
  return <span className="fp-mark" style={{ ...s, background: '#26a17b', borderRadius: '50%', color: '#fff', fontSize: size * 0.52 }}>₮</span>;
}

export function FundingPanel({ account, kind, onBalanceChange }: { account: TradingAccount | null; kind: 'deposit' | 'withdraw'; onBalanceChange: () => void }) {
  const { t, number, prefs } = useOrin(), nav = useNavigation();
  const rtl = prefs.chartLocale === 'ar', Fwd = rtl ? ArrowLeft : ArrowRight, Chev = rtl ? ChevronLeft : ChevronRight;
  const [ready, setReady] = useState<PaymentReadiness | null>(null), [items, setItems] = useState<DepositView[]>([]), [selected, setSelected] = useState<DepositView | null>(null), [amount, setAmount] = useState('1000'), [coin, setCoin] = useState<PaymentCoin>('usdttrc20'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState('');
  const [qr, setQr] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [wNet, setWNet] = useState<PaymentCoin>('usdttrc20'), [wAmount, setWAmount] = useState(''), [wAddress, setWAddress] = useState(''), [wNotice, setWNotice] = useState<any>(null);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [walletView, setWalletView] = useState<DemoWalletView | null>(null);
  const requestId = useRef<string | null>(null), mounted = useRef(true), submitting = useRef(false);
  const depositIntent = useRef('');
  const withdrawalIntent = useRef<{ fingerprint: string; id: string } | null>(null);

  const load = useCallback(async () => {
    if (account?.type !== 'real') return;
    try {
      const state = await paymentReadiness();
      if (!mounted.current) return;
      setReady(state);
      const history = await listDeposits(account.id);
      if (mounted.current) setItems(history.items);
      demoWalletRequest(account.id).then(w => { if (mounted.current) setWalletView(w); }).catch(() => {});
      apiFetch('/api/withdrawals').then(r => r.ok ? r.json() : null).then(d => {
        if (mounted.current && d?.items) setWithdrawals(d.items);
      }).catch(() => {});
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }, [account?.id, account?.type]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  useEffect(() => {
    if (!selected || selected.credited || ['finished', 'failed', 'expired'].includes(selected.status)) return;
    const timer = setInterval(() => { if (!busy && mounted.current) void refresh(selected); }, 12000);
    return () => clearInterval(timer);
  }, [selected, busy]);

  useEffect(() => {
    let live = true; setQr('');
    if (selected?.address) {
      QRCode.toDataURL(selected.address, { margin: 1, width: 440, errorCorrectionLevel: 'M', color: { dark: '#0a1d37', light: '#ffffff' } }).then(url => { if (live) setQr(url); }).catch(() => {});
    }
    return () => { live = false; };
  }, [selected?.address]);

  async function submit() {
    if (!account || !ready?.deposits || submitting.current) return;
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount) || !isNewDepositAmount(Math.round(Number(amount) * 100))) {
      setError(t('مبلغ الإيداع يجب أن يكون بين 100 و15,000 دولار أمريكي.', 'Deposits must be between $100 and $15,000 USD.'));
      return;
    }
    submitting.current = true; setBusy(true); setError('');
    const fingerprint = JSON.stringify([account.id, amount, coin]);
    if (depositIntent.current !== fingerprint) { requestId.current = null; depositIntent.current = fingerprint; }
    requestId.current ??= crypto.randomUUID();
    try {
      const item = await createDeposit({ accountId: account.id, amountCents: Math.round(Number(amount) * 100), coin, requestId: requestId.current });
      if (mounted.current) {
        setSelected(item);
        setStep(2);
        setItems(old => [item, ...old.filter(x => x.id !== item.id)]);
        requestId.current = null;
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function refresh(item: DepositView) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await refreshDeposit(item.id);
      if (mounted.current) {
        setSelected(result);
        setItems(old => old.map(x => x.id === result.id ? result : x));
        if (result.credited) onBalanceChange();
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => { if (mounted.current) setCopied(c => c === key ? '' : c); }, 1800);
    } catch {
      setError(t('حدد النص وانسخه يدويًا.', 'Select the text and copy it manually.'));
    }
  };

  const date = (n: number) => new Date(n).toLocaleDateString(prefs.chartLocale + '-u-nu-latn', { timeZone: prefs.timezone, year: 'numeric', month: 'long', day: 'numeric' });
  const time = (n: number) => new Date(n).toLocaleTimeString(prefs.chartLocale + '-u-nu-latn', { timeZone: prefs.timezone, hour: '2-digit', minute: '2-digit' });

  const Header = ({ title, sub }: { title: string; sub: string }) => (
    <header className="fp-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
      <div>
        <h1 style={{ fontSize: '26px', fontWeight: 800, margin: 0, color: 'var(--fp-ink)' }}>{title}</h1>
        <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--fp-muted)' }}>{sub}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button type="button" className="fp-back-btn" onClick={() => { if (selected) { setSelected(null); setStep(1); } else { nav.navigate('/'); } }} style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--fp-soft)', border: '1px solid var(--fp-line)', display: 'grid', placeItems: 'center', color: 'var(--fp-ink)', cursor: 'pointer' }}>
          <Fwd size={20} />
        </button>
      </div>
    </header>
  );

  const Note = ({ children, kind: k = 'warn' }: { children: ReactNode; kind?: 'warn' | 'info' }) => (
    <p className={'fp-note ' + k} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', fontSize: '13px', margin: '4px 0' }}>
      <Info size={18} style={{ flex: 'none', color: k === 'warn' ? '#e09a1c' : '#0788ff' }} />
      <span>{children}</span>
    </p>
  );

  const ErrorBox = () => error ? <p className="fp-error" role="alert"><CircleAlert size={17} /><span>{error}</span></p> : null;

  if (!account || account.type !== 'real') {
    return (
      <section className="fp">
        <Header title={kind === 'deposit' ? t('إيداع USDT', 'Deposit USDT') : t('سحب الأموال', 'Withdraw funds')} sub={t('حساب حقيقي · USD', 'Real account · USD')} />
        <div className="fp-card fp-empty"><LockKeyhole /><p>{t('الإيداع والسحب متاحان للحساب الحقيقي فقط. الرصيد التجريبي غير قابل للسحب.', 'Deposits and withdrawals require a real account. Demo funds cannot be withdrawn.')}</p></div>
      </section>
    );
  }

  const loading = !ready && (
    <div className="fp-card fp-empty">
      <span className="orin-loader" />
      <p>{error ? t('تعذر التحقق من الخدمة.', 'Unable to check service.') : t('جار التحقق من خدمة الدفع…', 'Checking payment service…')}</p>
    </div>
  );

  /* ───────────── WITHDRAWAL VIEW (Screenshot 3 & 4) ───────────── */
  if (kind === 'withdraw') {
    const net = PAYMENT_COINS.find(c => c.id === wNet)!;
    const futuresBal = (walletView?.wallet?.futuresCents ?? account?.balanceCents ?? 0) / 100;
    const perpBal = (walletView?.wallet?.perpetualCents ?? 0) / 100;
    // Withdrawable amount is strictly futuresBal (العقود الآجلة)
    const totalAvailable = futuresBal;
    const maxWithdraw = totalAvailable > 0 ? totalAvailable.toFixed(2) : '0';

    const requestWithdrawal = async () => {
      if (submitting.current) return;
      setError(''); setWNotice(null);
      const val = Number(wAmount);
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(wAmount) || val <= 0) {
        setError(t('أدخل مبلغ سحب صالحًا.', 'Enter a valid withdrawal amount.'));
        return;
      }
      if (wAddress.trim().length < 15) {
        setError(t('أدخل عنوان محفظة صالحًا.', 'Enter a valid wallet address.'));
        return;
      }
      if (val > totalAvailable) {
        setError(t(
          `الرصيد المتاح للسحب في العقود الآجلة هو ${totalAvailable.toFixed(2)} USDT. رصيد العقود الدائمة (${perpBal.toFixed(2)} USDT) مخصص للتداول فقط ولا يمكن سحبه مباشرة.`,
          `Available for withdrawal in Futures is ${totalAvailable.toFixed(2)} USDT. Permanent Contracts balance (${perpBal.toFixed(2)} USDT) is for trading only and cannot be withdrawn directly.`
        ));
        return;
      }

      try {
        submitting.current = true;
        setBusy(true);
        const fingerprint = JSON.stringify([account.id, Math.round(val * 100), wAddress.trim(), wNet]);
        if (withdrawalIntent.current?.fingerprint !== fingerprint) withdrawalIntent.current = { fingerprint, id: crypto.randomUUID() };
        const res = await apiFetch('/api/withdrawals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: withdrawalIntent.current.id,
            accountId: account?.id,
            amountCents: Math.round(val * 100),
            address: wAddress.trim(),
            coin: wNet,
            currency: 'USD'
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'تعذر إرسال طلب السحب');
        }
        if (!data.id || !Number.isSafeInteger(data.amountCents)) throw new Error(t('وصل رد غير مكتمل. راجع سجل السحب قبل إعادة المحاولة.', 'The response was incomplete. Check withdrawal history before retrying.'));
        setWNotice({
          id: data.id,
          accountId: data.accountId,
          amount: data.amountCents / 100,
          fee: Number.isSafeInteger(data.feeCents) ? data.feeCents / 100 : undefined,
          netAmount: Number.isSafeInteger(data.netAmountCents) ? data.netAmountCents / 100 : undefined,
          address: data.address,
          coin: data.coin,
          currency: data.currency,
          createdAt: data.createdAt,
          status: data.status,
          txHash: data.txHash
        });
        withdrawalIntent.current = null;
        setWAmount('');
        setWalletView(old => {
          if (!old?.wallet) return old;
          const deductCents = Math.round(val * 100);
          return {
            ...old,
            wallet: {
              ...old.wallet,
              futuresCents: Math.max(0, (Number(old.wallet.futuresCents || 0)) - deductCents)
            }
          };
        });
        onBalanceChange?.();
        void load();
      } catch (err: any) {
        setError(err.message || 'تعذر إرسال طلب السحب.');
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    };

    // Screenshot 1 & 2 — Clean 1-Page Receipt View matching attached screenshots
    if (wNotice) {
      return (
        <WithdrawalReceiptView
          withdrawal={wNotice}
          onClose={() => {
            setWNotice(null);
            nav.navigate('/activity');
          }}
        />
      );
    }

    // Screenshot 3 — Clean Withdraw Form
    return (
      <section className="fp" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
        <Header title={t('سحب الأموال', 'Withdraw funds')} sub={t('حساب حقيقي · USD', 'Real account · USD')} />

        <div className="fp-hero-pay" style={{ borderRadius: '20px', padding: '18px 20px', background: 'radial-gradient(90% 140% at 15% 50%,#1f6eff 0%,transparent 60%),linear-gradient(120deg,#0a339c 0%,#09226b 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <div>
            <b style={{ fontSize: '22px', fontWeight: 800, display: 'block' }}>ORIN Pay</b>
            <small style={{ fontSize: '13px', color: '#b9cdf5' }}>{t('سحب العملات الرقمية', 'Crypto withdrawal')}</small>
          </div>
          <span style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Wallet size={24} />
          </span>
        </div>

        {loading || (
          <>
            <div className="fp-card" style={{ background: '#fff', border: '1px solid var(--fp-line)', borderRadius: '20px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--fp-ink)' }}>{t('تفاصيل السحب', 'Withdrawal details')}</h2>

              {/* Dual Balance Display: Withdrawable vs Permanent Trading */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 16px', borderRadius: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '13.5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--fp-muted)', fontWeight: 600 }}>{t('الرصيد المتاح للسحب (العقود الآجلة)', 'Available for withdrawal (Futures)')}:</span>
                  <strong style={{ color: '#0788ff', fontSize: '16px', fontWeight: 800 }} dir="ltr">{totalAvailable.toFixed(2)} USDT</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                  <span style={{ color: '#64748b', fontSize: '12.5px' }}>{t('رصيد العقود الدائمة (للتداول فقط - غير قابل للسحب)', 'Permanent Contracts (Trading only - non-withdrawable)')}:</span>
                  <span style={{ color: '#64748b', fontSize: '13.5px', fontWeight: 700 }} dir="ltr">{perpBal.toFixed(2)} USDT</span>
                </div>
              </div>

              {/* Helpful Transfer Prompt if balance is in permanent trading wallet */}
              {totalAvailable <= 0 && perpBal > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', borderRadius: '14px', background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '13px', color: '#166534' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Info size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{t('رصيدك متاح بالكامل في محفظة التداول (العقود الدائمة)', 'Your balance is in Trading (Permanent Contracts)')}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.5 }}>
                    {t('العقود الدائمة مخصصة للتداول وحمايتها تامة. للسحب، يرجى نقل المبلغ الذي ترغب في سحبه إلى العقود الآجلة (المتاحة للسحب) وفق سياسة إدارة رأس المال.', 'Permanent contracts are reserved for trading. To withdraw, transfer your desired amount to Futures (Withdrawable) per capital management policy.')}
                  </p>
                  <button
                    type="button"
                    onClick={() => nav.navigate('/transfer')}
                    style={{ alignSelf: 'flex-start', background: '#16a34a', color: '#fff', border: 0, padding: '6px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', marginTop: '2px' }}
                  >
                    {t('التحويل إلى محفظة السحب الآن ⇄', 'Transfer to Withdrawal Wallet Now ⇄')}
                  </button>
                </div>
              )}

              <label className="fp-label" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fp-muted)', marginTop: '4px' }}>{t('شبكة التحويل', 'Transfer Network')}</label>
              <div className="fp-select" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px', height: '52px', border: '1px solid #dbe4f2', borderRadius: '14px', padding: '0 14px', background: 'var(--fp-soft)', width: '100%', boxSizing: 'border-box' }}>
                <Mark kind={wNet} size={28} />
                <b style={{ flex: 1, minWidth: 0, fontSize: '14.5px', fontFamily: 'Arial, sans-serif' }} dir="ltr">{net.label} · {net.network}</b>
                <ChevronDown size={18} style={{ color: '#5d6f8e', flexShrink: 0 }} />
                <select aria-label={t('شبكة التحويل', 'Network')} value={wNet} onChange={e => setWNet(e.target.value as PaymentCoin)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}>
                  {PAYMENT_COINS.map(c => <option key={c.id} value={c.id}>{c.label} · {c.network}</option>)}
                </select>
              </div>

              <label className="fp-label" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fp-muted)' }}>{t('مبلغ السحب', 'Withdrawal Amount')}</label>
              <div className="fp-input" style={{ display: 'flex', alignItems: 'stretch', height: '52px', border: '1px solid #dbe4f2', borderRadius: '14px', overflow: 'hidden', background: 'var(--fp-soft)', width: '100%', boxSizing: 'border-box' }}>
                <input inputMode="decimal" dir="ltr" placeholder={t('أدخل المبلغ', 'Enter amount')} value={wAmount} onChange={e => setWAmount(e.target.value)} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', padding: '0 16px', fontSize: '16px', color: 'var(--fp-ink)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', background: '#f0f4fa', borderInlineStart: '1px solid #dbe4f2', flexShrink: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: '13px', color: '#4a5d7f' }}>USDT</span>
                  <button
                    type="button"
                    onClick={() => setWAmount(maxWithdraw)}
                    style={{ border: 0, background: '#0788ff', color: '#fff', padding: '4px 8px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {t('الكل', 'All')}
                  </button>
                </div>
              </div>

              {/* Real-time 5% Fee Calculation */}
              {Number(wAmount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '13px' }}>
                  <span style={{ color: '#166534' }}>
                    {t('رسوم السحب (5%):', 'Withdrawal Fee (5%):')} <b dir="ltr" style={{ color: '#dc2626' }}>-{(Number(wAmount) * 0.05).toFixed(2)} USDT</b>
                  </span>
                  <span style={{ color: '#166534', fontWeight: 700 }}>
                    {t('صافي الاستلام:', 'Net payout:')} <b dir="ltr" style={{ color: '#0788ff' }}>{(Number(wAmount) * 0.95).toFixed(2)} USDT</b>
                  </span>
                </div>
              )}

              <label className="fp-label" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fp-muted)' }}>{t('عنوان المحفظة', 'Wallet Address')}</label>
              <div className="fp-input" style={{ display: 'flex', alignItems: 'stretch', height: '52px', border: '1px solid #dbe4f2', borderRadius: '14px', overflow: 'hidden', background: 'var(--fp-soft)', width: '100%', boxSizing: 'border-box' }}>
                <input dir="ltr" autoComplete="off" spellCheck={false} placeholder={t('أدخل عنوان محفظتك', 'Enter your wallet address')} value={wAddress} onChange={e => setWAddress(e.target.value.trim())} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', padding: '0 16px', fontSize: '14.5px', color: 'var(--fp-ink)' }} />
                <span style={{ display: 'grid', placeItems: 'center', padding: '0 14px', color: '#5d6f8e', flexShrink: 0 }}>
                  <ScanLine size={20} />
                </span>
              </div>

              <Note kind="info">{t('رسوم السحب العادية 5% وفق سياسة إدارة رأس المال المعتمدة. تُخصم تلقائياً من المبلغ المطلوب.', 'Standard withdrawal fee is 5% in accordance with the approved capital management policy. Automatically deducted from requested amount.')}</Note>
            </div>

            <ErrorBox />

            <button
              type="button"
              className="fp-btn primary big"
              disabled={busy || totalAvailable <= 0}
              onClick={requestWithdrawal}
              style={{
                width: '100%',
                height: '54px',
                borderRadius: '16px',
                background: (totalAvailable <= 0) ? '#94a3b8' : 'linear-gradient(180deg,#1c8cff 0%,#0064f4 100%)',
                color: '#fff',
                border: 0,
                fontSize: '16px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: (busy || totalAvailable <= 0) ? 'not-allowed' : 'pointer',
                opacity: (busy || totalAvailable <= 0) ? 0.65 : 1,
                boxShadow: (totalAvailable <= 0) ? 'none' : '0 10px 22px rgba(10,108,255,0.3)',
                boxSizing: 'border-box'
              }}
            >
              <Fwd size={18} />
              {busy ? t('جار المعالجة…', 'Processing…') : totalAvailable <= 0 ? (perpBal > 0 ? t('الرصيد في التداول (حوّل للسحب أولاً)', 'Balance in Trading (Transfer to Withdraw)') : t('الرصيد المتاح 0 (لا يمكن السحب)', 'Available Balance is 0')) : t('طلب السحب', 'Request Withdrawal')}
            </button>

            <button type="button" className="fp-btn outline big" onClick={() => nav.navigate('/support')} style={{ width: '100%', height: '54px', borderRadius: '16px', background: '#fff', color: '#173a77', border: '1px solid #9fbff0', fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', boxSizing: 'border-box' }}>
              <MessageCircleMore size={20} />
              {t('التواصل مع الدعم', 'Contact Support')}
            </button>

            <p style={{ textAlign: 'center', fontSize: '12.5px', color: 'var(--fp-muted)', margin: 0 }}>
              {t('تخضع الطلبات لشروط السحب المعتمدة', 'Requests are subject to approved withdrawal terms')}
            </p>

            {/* Recent Withdrawals List */}
            {withdrawals.length > 0 && (
              <div className="fp-history" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 4px', color: 'var(--fp-ink)' }}>{t('آخر طلبات السحب', 'Recent Withdrawals')}</h3>
                {withdrawals.map(item => {
                  const amt = (Number(item.amount_cents || item.amountCents || 0) / 100);
                  const st = item.status;
                  const stLabel = st === 'paid' ? t('مكتمل (مدفوع)', 'Paid') : st === 'approved' ? t('معتمد', 'Approved') : st === 'rejected' ? t('مرفوض (مسترد)', 'Rejected') : t('قيد المراجعة', 'Under review');
                  const stColor = st === 'paid' ? '#10b981' : st === 'approved' ? '#0788ff' : st === 'rejected' ? '#ef4444' : '#f59e0b';
                  const stBg = st === 'paid' ? '#ecfdf5' : st === 'approved' ? '#eff6ff' : st === 'rejected' ? '#fef2f2' : '#fffbeb';
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => nav.navigate('/activity')}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px',
                        background: '#fff',
                        border: '1px solid var(--fp-line)',
                        borderRadius: '16px',
                        cursor: 'pointer',
                        textAlign: 'start'
                      }}
                    >
                      <div>
                        <b style={{ display: 'block', fontSize: '16px', fontFamily: 'Arial, sans-serif', color: 'var(--fp-ink)' }}>
                          {number(amt)} USD
                        </b>
                        <small style={{ color: 'var(--fp-muted)', fontSize: '12px' }}>
                          {new Intl.DateTimeFormat(prefs.chartLocale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
                            timeZone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          }).format(new Date(item.created_at || item.createdAt))} · {item.coin || 'USDT'}
                        </small>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 700, padding: '4px 10px', borderRadius: '99px', background: stBg, color: stColor }}>
                          {stLabel}
                        </span>
                        <Chev size={18} style={{ color: '#9aa8bf' }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    );
  }

  /* ───────────── DEPOSIT VIEW (Screenshot 1 & 2) ───────────── */
  const selectedCoinObj = PAYMENT_COINS.find(x => x.id === (selected?.coin ?? coin));

  // Screenshot 1 — Deposit Details View (Step 2)
  if (step === 2 || (selected && selected.address)) {
    const payAmountStr = selected?.payAmount ?? '—';

    return (
      <section className="fp">
        <Header title={t('إيداع ', 'Deposit ') + (selectedCoinObj?.label ?? '')} sub={t('تفاصيل التحويل', 'Transfer Details')} />

        {/* Blue Gradient Hero Card */}
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '22px', padding: '20px', color: '#fff', background: 'radial-gradient(110% 140% at 85% 0%,#1c53d9 0%,transparent 60%),linear-gradient(135deg,#071842 0%,#0a2873 100%)', boxShadow: '0 14px 30px rgba(11,42,107,0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <small style={{ fontSize: '13px', color: '#b9cdf5' }}>{t('المبلغ المطلوب', 'Amount to send')}</small>
              <strong style={{ display: 'block', fontSize: '32px', fontWeight: 800, marginTop: '4px', fontFamily: 'Arial, sans-serif' }} dir="ltr">
                {payAmountStr} {selectedCoinObj?.label ?? ''}
              </strong>
            </div>

            <span style={{ background: 'rgba(255,232,184,0.15)', color: '#ffd27a', border: '1px solid rgba(255,201,93,0.4)', padding: '6px 14px', borderRadius: '99px', fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Clock3 size={15} />
              {selected ? t(...statuses[selected.status]) : t('تفاصيل الدفع غير متاحة', 'Payment details unavailable')}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.18)', marginTop: '16px', paddingTop: '14px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mark kind={selectedCoinObj?.id ?? ''} size={28} />
              <b style={{ fontSize: '16px', fontFamily: 'Arial, sans-serif' }}>{selectedCoinObj?.label ?? '—'}</b>
            </span>

            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mark kind={selectedCoinObj?.id ?? ''} size={28} />
              <span className="fp-chip" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', fontSize: '12px' }} dir="ltr">{selectedCoinObj?.network ?? '—'}</span>
            </span>
          </div>
        </div>

        {/* Deposit QR & Address Main Card */}
        <div className="fp-card" style={{ background: '#fff', border: '1px solid var(--fp-line)', borderRadius: '22px', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--fp-ink)' }}>{t('رمز الإيداع', 'Deposit Code')}</h2>
          <p style={{ margin: '-6px 0 0', fontSize: '13px', color: 'var(--fp-muted)' }} dir="ltr">{selectedCoinObj?.network ?? '—'}</p>

          <div className="fp-qr" style={{ position: 'relative', width: '200px', height: '200px', display: 'grid', placeItems: 'center', margin: '8px 0', padding: '14px' }}>
            <span className="c tl" />
            <span className="c tr" />
            <span className="c bl" />
            <span className="c br" />
            {qr && selected?.address ? <img src={qr} alt="Deposit Address QR" style={{ width: '100%', height: '100%', borderRadius: '12px', background: '#fff' }} /> : <span>{t('عنوان الدفع غير متاح بعد', 'Payment address not yet available')}</span>}
          </div>

          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--fp-muted)' }}>{t('رمز QR لعنوان هذا الطلب فقط', 'QR code for this payment order only')}</p>

          <hr style={{ border: 0, borderTop: '1px solid var(--fp-line)', width: '100%', margin: '4px 0' }} />

          <label className="fp-label" style={{ alignSelf: 'flex-start', fontSize: '13px', color: 'var(--fp-muted)' }}>{t('عنوان الإيداع', 'Deposit Address')}</label>
          <div className="fp-address" style={{ width: '100%', background: 'var(--fp-soft)', border: '1px solid #dbe4f2', borderRadius: '14px', padding: '14px', fontFamily: 'monospace', fontSize: '14.5px', wordBreak: 'break-all', color: 'var(--fp-ink)' }} dir="ltr">
            {selected?.address || t('لم يصدر عنوان من مزود الدفع بعد.', 'The provider has not issued an address yet.')}
          </div>

          <button type="button" className="fp-btn primary" disabled={!selected?.address} onClick={() => { if (selected?.address) void copy(selected.address, 'depAddr'); }} style={{ width: '100%', height: '50px', borderRadius: '14px', background: 'linear-gradient(180deg,#1c8cff 0%,#0064f4 100%)', color: '#fff', border: 0, fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
            <Copy size={18} />
            {copied === 'depAddr' ? t('تم النسخ', 'Copied') : t('نسخ عنوان الإيداع', 'Copy Deposit Address')}
          </button>
        </div>

        <Note kind="info">{t('أرسل فقط العملة والشبكة المحددتين لهذا الطلب: ', 'Send only the currency and network specified for this order: ')}{selectedCoinObj ? `${selectedCoinObj.label} · ${selectedCoinObj.network}` : '—'}</Note>
        {selected && !selected.address && <button type="button" className="fp-btn outline" disabled={busy} onClick={() => void refresh(selected)}>{t('تحديث بيانات الدفع', 'Refresh payment details')}</button>}

        <button type="button" className="fp-btn outline" onClick={() => setStep(1)} style={{ width: '100%', height: '50px', borderRadius: '14px', background: '#fff', border: '1px solid #d5dfee', color: '#2c3e62', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
          {t('العودة إلى الإيداعات', 'Return to Deposits')}
        </button>

        {/* Recent Deposits Section */}
        {items.length > 0 && (
          <div className="fp-history" style={{ marginTop: '12px' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 10px' }}>{t('آخر الإيداعات', 'Recent Deposits')}</h3>
            {items.map(item => (
              <button type="button" key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => { setSelected(item); setStep(2); }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: '#fff', border: '1px solid var(--fp-line)', borderRadius: '16px', marginTop: '8px' }}>
                <div style={{ textAlign: 'start' }}>
                  <b style={{ display: 'block', fontSize: '16px', fontFamily: 'Arial, sans-serif' }}>{number(item.amountCents / 100)} USD</b>
                  <small style={{ color: 'var(--fp-muted)', fontSize: '12px' }}>{new Date(item.createdAt).toLocaleDateString('en-CA')}</small>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={'fp-dot-status ' + tone(item.status, item.credited)} style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f0a020', display: 'inline-block' }} />
                    {t(...statuses[item.status])}
                  </span>
                  <Chev size={18} style={{ color: '#9aa8bf' }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  // Screenshot 2 — Deposit Step 1 (اختر شبكة الإيداع)
  return (
    <section className="fp">
      <Header title={t('إيداع USDT', 'Deposit USDT')} sub={t('اختر شبكة الإيداع', 'Choose Deposit Network')} />

      {/* Progress Stepper */}
      <ol className="fp-steps" style={{ display: 'flex', alignItems: 'center', gap: '10px', listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
        <li className="on" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0788ff', fontWeight: 700, fontSize: '13px' }}>
          <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#0788ff', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>1</span>
          {t('اختيار الشبكة', 'Select Network')}
        </li>
        <li style={{ flex: 1, height: '1.5px', background: '#dbe4f2' }} />
        <li style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--fp-muted)', fontSize: '13px' }}>
          <span style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #b8c4d8', background: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600 }}>2</span>
          {t('عنوان الإيداع', 'Deposit Address')}
        </li>
      </ol>

      {/* Hero Currency Card */}
      <div style={{ borderRadius: '20px', padding: '18px 20px', color: '#fff', background: 'radial-gradient(110% 140% at 85% 0%,#1c53d9 0%,transparent 60%),linear-gradient(135deg,#071842 0%,#0a2873 100%)' }}>
        <small style={{ fontSize: '12.5px', color: '#b9cdf5' }}>{t('عملة الإيداع', 'Deposit Currency')}</small>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '8px' }}>
          <Mark kind={coin} size={48} />
          <div>
            <strong style={{ fontSize: '26px', fontWeight: 800, fontFamily: 'Arial, sans-serif', display: 'block', lineHeight: 1.1 }}>{selectedCoinObj?.label ?? '—'}</strong>
            <span style={{ fontSize: '13.5px', color: '#b9cdf5' }}>{selectedCoinObj ? COIN_NAMES[selectedCoinObj.label] : '—'}</span>
          </div>
        </div>
      </div>

      <div className="fp-card">
        <label className="fp-label" htmlFor="deposit-usd-amount">{t('مبلغ الإيداع بالدولار (100–15,000)', 'Deposit amount in USD (100–15,000)')}</label>
        <input id="deposit-usd-amount" inputMode="decimal" dir="ltr" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} aria-describedby="deposit-amount-limits" />
        <small id="deposit-amount-limits">{t('يضاف الرصيد بعد تأكيد استلام الدفعة فقط.', 'Funds are credited only after payment receipt is confirmed.')}</small>
      </div>

      {/* Network Selection Options */}
      <div className="fp-card" style={{ background: '#fff', border: '1px solid var(--fp-line)', borderRadius: '20px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--fp-ink)' }}>{t('شبكة التحويل', 'Transfer Network')}</h2>
        <p style={{ margin: '-4px 0 6px', fontSize: '12.5px', color: 'var(--fp-muted)' }}>{t('اختر الشبكة المستخدمة في محفظتك', 'Choose the network used by your wallet')}</p>

        <div className="fp-options" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {PAYMENT_COINS.map(option => ({ id: option.id, name: option.label, network: option.network, icon: option.id })).map(c => {
            const on = coin === c.id;
            return (
              <button
                type="button"
                key={c.id}
                className={'fp-option' + (on ? ' on' : '')}
                onClick={() => setCoin(c.id as PaymentCoin)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  borderRadius: '16px',
                  border: on ? '2px solid #0788ff' : '1px solid var(--fp-line)',
                  background: on ? '#f4f8ff' : '#fff',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '22px', height: '22px', borderRadius: '50%', border: on ? '6px solid #0788ff' : '2px solid #b8c4d8', background: '#fff', display: 'inline-block' }} />
                  {on && <small style={{ color: '#0788ff', fontWeight: 700, fontSize: '12px' }}>{t('تم الاختيار', 'Selected')}</small>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ textAlign: 'end' }}>
                    <b style={{ fontSize: '16px', fontWeight: 700, display: 'block', fontFamily: 'Arial, sans-serif', color: 'var(--fp-ink)' }}>{c.name}</b>
                    <span className="fp-chip" style={{ fontSize: '12px' }} dir="ltr">{c.network}</span>
                  </div>
                  <Mark kind={c.icon} size={36} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Note>{t('يجب أن تتطابق شبكة الإرسال مع شبكة الإيداع.', 'Your sending network must match the deposit network.')}</Note>

      <ErrorBox />

      <button type="button" className="fp-btn primary big" disabled={busy} onClick={() => void submit()} style={{ width: '100%', height: '54px', borderRadius: '16px', background: 'linear-gradient(180deg,#1c8cff 0%,#0064f4 100%)', color: '#fff', border: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', boxShadow: '0 10px 22px rgba(10,108,255,0.3)' }}>
        {busy ? <RefreshCw size={18} className="fp-spin" /> : <Fwd size={18} />}
        {t('متابعة إلى عنوان الإيداع', 'Continue to Deposit Address')}
      </button>

      <p style={{ textAlign: 'center', fontSize: '12.5px', color: 'var(--fp-muted)', margin: 0 }}>
        {t('سيظهر عنوان الإيداع ورمز QR في الخطوة التالية', 'Deposit address and QR code will appear in the next step')}
      </p>
    </section>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Copy, LockKeyhole, RefreshCw, Clock3, Info, ArrowLeft, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ScanLine, Wallet, MessageCircleMore, ArrowDownLeft, ArrowUpRight, Check, CircleCheck, CircleAlert } from 'lucide-react';
import { createDeposit, listDeposits, paymentReadiness, refreshDeposit } from '@/lib/payment-client';
import { PAYMENT_COINS, type PaymentCoin, type PaymentReadiness, type DepositView, type DepositStatus } from '@/lib/payments';
import type { TradingAccount } from '@/lib/trading-accounts';
import { useOrin } from './orin-settings';
import { useNavigation } from './orin-navigation';
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
  const requestId = useRef<string | null>(null), mounted = useRef(true), submitting = useRef(false);

  const load = useCallback(async () => {
    if (account?.type !== 'real') return;
    try {
      const state = await paymentReadiness();
      if (!mounted.current) return;
      setReady(state);
      const history = await listDeposits(account.id);
      if (mounted.current) setItems(history.items);
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
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount) || Number(amount) < 1000 || Number(amount) > 100000) {
      setError(t('الحد الأدنى للإيداع هو 1,000 دولار أمريكي. أدخل مبلغًا صالحًا.', 'Minimum deposit is $1,000 USD. Enter a valid amount.'));
      return;
    }
    submitting.current = true; setBusy(true); setError('');
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

  const finishedDeposits = items.filter(x => x.status === 'finished' || x.credited);
  const latestDeposit = finishedDeposits[0];
  const elapsedDays = latestDeposit ? Math.floor((Date.now() - latestDeposit.createdAt) / 86400000) : 0;
  const lockRemainingDays = latestDeposit ? Math.max(0, 29 - elapsedDays) : 29;

  const loading = !ready && (
    <div className="fp-card fp-empty">
      <span className="orin-loader" />
      <p>{error ? t('تعذر التحقق من الخدمة.', 'Unable to check service.') : t('جار التحقق من خدمة الدفع…', 'Checking payment service…')}</p>
    </div>
  );

  /* ───────────── WITHDRAWAL VIEW (Screenshot 3 & 4) ───────────── */
  if (kind === 'withdraw') {
    const net = PAYMENT_COINS.find(c => c.id === wNet)!;

    const requestWithdrawal = () => {
      setError(''); setWNotice(null);
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(wAmount) || Number(wAmount) <= 0) {
        setError(t('أدخل مبلغ سحب صالحًا.', 'Enter a valid withdrawal amount.'));
        return;
      }
      if (wAddress.trim().length < 20) {
        setError(t('أدخل عنوان محفظة صالحًا.', 'Enter a valid wallet address.'));
        return;
      }
      if (lockRemainingDays > 0) {
        setError(latestDeposit ? t(`لا يمكن السحب قبل مرور 29 يومًا من تاريخ الإيداع. متبقي ${lockRemainingDays} يومًا.`, `Withdrawals open 29 days after deposit. ${lockRemainingDays} days remaining.`) : t('لا يمكن السحب إلا بعد مرور 29 يومًا من تاريخ أول إيداع مؤكد.', 'Withdrawals open 29 days after your first confirmed deposit.'));
        return;
      }

      setWNotice({
        id: 'WD-DEMO-001',
        amount: Number(wAmount),
        fee: 25.00,
        netAmount: Math.max(0, Number(wAmount) - 25),
        address: wAddress,
        coin: wNet,
        network: net.network,
        createdAt: Date.now()
      });
    };

    // Screenshot 4 — Receipt Modal
    if (wNotice) {
      return (
        <section className="fp fp-receipt-wrap">
          <header className="fp-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: 0 }}>{t('تفاصيل المعاملة', 'Transaction details')}</h1>
            <button type="button" className="fp-back-btn" onClick={() => setWNotice(null)} style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--fp-soft)', border: '1px solid var(--fp-line)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <Fwd size={20} />
            </button>
          </header>

          <article className="fp-receipt-card" style={{ background: '#fff', border: '1px solid var(--fp-line)', borderRadius: '22px', overflow: 'hidden', boxShadow: '0 12px 32px rgba(11,42,107,0.08)' }}>
            <div style={{ padding: '24px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#e8f2ff', color: '#0788ff', display: 'grid', placeItems: 'center' }}>
                <ArrowUpRight size={28} />
              </span>
              <small style={{ fontSize: '15px', color: '#2c3e62', fontWeight: 600 }}>{t('سحب USDT', 'USDT Withdrawal')}</small>
              <strong style={{ fontSize: '38px', fontWeight: 800, color: 'var(--fp-ink)', fontFamily: 'Arial, sans-serif' }}>
                {number(wNotice.amount)} <em style={{ fontSize: '20px', fontStyle: 'normal' }}>USDT</em>
              </strong>
              <span className="fp-pill wait" style={{ background: '#fff1d6', color: '#9a6412', padding: '6px 16px', borderRadius: '99px', fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Clock3 size={15} />
                {t('قيد المراجعة', 'Under Review')}
              </span>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--fp-muted)' }}>{t('بانتظار تنفيذ التحويل', 'Awaiting transfer execution')}</p>
            </div>

            <div style={{ borderTop: '1.5px dashed #d8e1ee', margin: '0 20px', position: 'relative' }} />

            <div style={{ padding: '20px' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 700 }}>{t('تفاصيل التحويل', 'Transfer details')}</h3>
              <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('رقم الطلب', 'Order ID')}</dt>
                  <dd style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }} dir="ltr">
                    {wNotice.id}
                    <button type="button" onClick={() => copy(wNotice.id, 'wdId')} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0, color: '#5d6f8e' }}>
                      {copied === 'wdId' ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('الشبكة', 'Network')}</dt>
                  <dd style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }} dir="ltr">
                    <Mark kind={wNotice.coin} size={20} />
                    {wNotice.network}
                  </dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('التاريخ', 'Date')}</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{date(wNotice.createdAt)}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('الوقت', 'Time')}</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }} dir="ltr">{time(wNotice.createdAt)}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('عنوان الاستلام', 'Recipient Address')}</dt>
                  <dd style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }} dir="ltr">
                    {wNotice.address.slice(0, 4) + '••••••••••••' + wNotice.address.slice(-3)}
                    <button type="button" onClick={() => copy(wNotice.address, 'wdAddr')} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0, color: '#5d6f8e' }}>
                      {copied === 'wdAddr' ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('معرّف التحويل', 'TxID')}</dt>
                  <dd style={{ margin: 0, color: 'var(--fp-muted)' }}>{t('لم يصدر بعد', 'Not issued yet')}</dd>
                </div>
                <hr style={{ border: 0, borderTop: '1px solid #edf1f8', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('مبلغ السحب', 'Withdrawal Amount')}</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }} dir="ltr">{number(wNotice.amount)} USDT</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <dt style={{ color: 'var(--fp-muted)' }}>{t('الرسوم', 'Fees')}</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }} dir="ltr">{number(wNotice.fee)} USDT</dd>
                </div>
              </dl>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', padding: '14px 16px', borderRadius: '14px', background: 'linear-gradient(120deg,#eaf3ff,#dcebff)' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#00388c' }}>{t('صافي الاستلام', 'Net Receive Amount')}</span>
                <b style={{ fontSize: '20px', color: '#0788ff', fontFamily: 'Arial, sans-serif' }} dir="ltr">{number(wNotice.netAmount)} USDT</b>
              </div>
            </div>
          </article>

          <button type="button" onClick={() => nav.navigate('/support')} style={{ border: 0, background: 'none', color: '#173a77', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', margin: '8px 0' }}>
            <MessageCircleMore size={18} style={{ color: '#0788ff' }} />
            {t('تحتاج مساعدة؟', 'Need help?')}
          </button>

          <button type="button" className="fp-btn primary big" onClick={() => setWNotice(null)}>
            <Fwd size={18} className="fp-flip" />
            {t('العودة إلى المعاملات', 'Return to Transactions')}
          </button>

          <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--fp-muted)', margin: 0 }}>
            {t('نموذج توضيحي · ليست معاملة فعلية', 'Illustration model · Not an active transaction')}
          </p>
        </section>
      );
    }

    // Screenshot 3 — Withdraw Form
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
                <span className="fp-suffix" style={{ display: 'grid', placeItems: 'center', padding: '0 16px', background: '#f0f4fa', borderInlineStart: '1px solid #dbe4f2', fontWeight: 700, fontSize: '14px', color: '#4a5d7f', flexShrink: 0 }}>USDT</span>
              </div>

              <label className="fp-label" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fp-muted)' }}>{t('عنوان المحفظة', 'Wallet Address')}</label>
              <div className="fp-input" style={{ display: 'flex', alignItems: 'stretch', height: '52px', border: '1px solid #dbe4f2', borderRadius: '14px', overflow: 'hidden', background: 'var(--fp-soft)', width: '100%', boxSizing: 'border-box' }}>
                <input dir="ltr" autoComplete="off" spellCheck={false} placeholder={t('أدخل عنوان محفظتك', 'Enter your wallet address')} value={wAddress} onChange={e => setWAddress(e.target.value.trim())} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', padding: '0 16px', fontSize: '14.5px', color: 'var(--fp-ink)' }} />
                <span style={{ display: 'grid', placeItems: 'center', padding: '0 14px', color: '#5d6f8e', flexShrink: 0 }}>
                  <ScanLine size={20} />
                </span>
              </div>

              <Note kind="info">{t('تأكد من تطابق عنوان المحفظة مع الشبكة المختارة', 'Make sure wallet address matches the selected network')}</Note>
            </div>

            {lockRemainingDays > 0 && (
              <p className="fp-note warn" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', background: '#fff6e6', border: '1px solid #f5dfb3', color: '#8a5b13', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}>
                <LockKeyhole size={18} style={{ color: '#e09a1c', flexShrink: 0 }} />
                <span><b>{t('فترة الحجز 29 يومًا', '29-day holding period')}</b> · {latestDeposit ? t(`متبقي ${lockRemainingDays} يومًا لإتاحة السحب.`, `${lockRemainingDays} days until withdrawals open.`) : t('يتاح السحب بعد 29 يومًا من أول إيداع مؤكد.', 'Withdrawals open 29 days after your first confirmed deposit.')}</span>
              </p>
            )}

            <ErrorBox />

            <button type="button" className="fp-btn primary big" onClick={requestWithdrawal} style={{ width: '100%', height: '54px', borderRadius: '16px', background: 'linear-gradient(180deg,#1c8cff 0%,#0064f4 100%)', color: '#fff', border: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', boxShadow: '0 10px 22px rgba(10,108,255,0.3)', boxSizing: 'border-box' }}>
              <Fwd size={18} />
              {t('طلب السحب', 'Request Withdrawal')}
            </button>

            <button type="button" className="fp-btn outline big" onClick={() => nav.navigate('/support')} style={{ width: '100%', height: '54px', borderRadius: '16px', background: '#fff', color: '#173a77', border: '1px solid #9fbff0', fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', boxSizing: 'border-box' }}>
              <MessageCircleMore size={20} />
              {t('التواصل مع الدعم', 'Contact Support')}
            </button>

            <p style={{ textAlign: 'center', fontSize: '12.5px', color: 'var(--fp-muted)', margin: 0 }}>
              {t('تخضع الطلبات لشروط السحب المعتمدة', 'Requests are subject to approved withdrawal terms')}
            </p>
          </>
        )}
      </section>
    );
  }

  /* ───────────── DEPOSIT VIEW (Screenshot 1 & 2) ───────────── */
  const selectedCoinObj = PAYMENT_COINS.find(x => x.id === (selected?.coin ?? coin))!;

  // Screenshot 1 — Deposit Details View (Step 2)
  if (step === 2 || (selected && selected.address)) {
    const payAmountStr = selected?.payAmount ?? (amount ? `${amount}.00` : '—');

    return (
      <section className="fp">
        <Header title={t('إيداع USDT', 'Deposit USDT')} sub={t('تفاصيل التحويل', 'Transfer Details')} />

        {/* Blue Gradient Hero Card */}
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '22px', padding: '20px', color: '#fff', background: 'radial-gradient(110% 140% at 85% 0%,#1c53d9 0%,transparent 60%),linear-gradient(135deg,#071842 0%,#0a2873 100%)', boxShadow: '0 14px 30px rgba(11,42,107,0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <small style={{ fontSize: '13px', color: '#b9cdf5' }}>{t('المبلغ المطلوب', 'Amount to send')}</small>
              <strong style={{ display: 'block', fontSize: '32px', fontWeight: 800, marginTop: '4px', fontFamily: 'Arial, sans-serif' }} dir="ltr">
                — USDT
              </strong>
            </div>

            <span style={{ background: 'rgba(255,232,184,0.15)', color: '#ffd27a', border: '1px solid rgba(255,201,93,0.4)', padding: '6px 14px', borderRadius: '99px', fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Clock3 size={15} />
              {t('بانتظار التحويل', 'Awaiting Transfer')}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.18)', marginTop: '16px', paddingTop: '14px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mark kind="usdt" size={28} />
              <b style={{ fontSize: '16px', fontFamily: 'Arial, sans-serif' }}>USDT</b>
            </span>

            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mark kind="usdttrc20" size={28} />
              <span className="fp-chip" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', fontSize: '12px' }} dir="ltr">TRON · TRC20</span>
            </span>
          </div>
        </div>

        {/* Deposit QR & Address Main Card */}
        <div className="fp-card" style={{ background: '#fff', border: '1px solid var(--fp-line)', borderRadius: '22px', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--fp-ink)' }}>{t('رمز الإيداع', 'Deposit Code')}</h2>
          <p style={{ margin: '-6px 0 0', fontSize: '13px', color: 'var(--fp-muted)' }} dir="ltr">شبكة TRON · TRC20</p>

          <div className="fp-qr" style={{ position: 'relative', width: '200px', height: '200px', display: 'grid', placeItems: 'center', margin: '8px 0', padding: '14px' }}>
            <span className="c tl" />
            <span className="c tr" />
            <span className="c bl" />
            <span className="c br" />
            {qr ? <img src={qr} alt="Deposit Address QR" style={{ width: '100%', height: '100%', borderRadius: '12px', background: '#fff' }} /> : <span className="orin-loader" />}
          </div>

          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--fp-muted)' }}>{t('رمز QR توضيحي', 'Illustration QR Code')}</p>

          <hr style={{ border: 0, borderTop: '1px solid var(--fp-line)', width: '100%', margin: '4px 0' }} />

          <label className="fp-label" style={{ alignSelf: 'flex-start', fontSize: '13px', color: 'var(--fp-muted)' }}>{t('عنوان الإيداع', 'Deposit Address')}</label>
          <div className="fp-address" style={{ width: '100%', background: 'var(--fp-soft)', border: '1px solid #dbe4f2', borderRadius: '14px', padding: '14px', fontFamily: 'monospace', fontSize: '14.5px', wordBreak: 'break-all', color: 'var(--fp-ink)' }} dir="ltr">
            {selected?.address || 'TAb9uNeXzJeSWuAkiVv6d95oyZ2Jk8Qgas'}
          </div>

          <button type="button" className="fp-btn primary" onClick={() => copy(selected?.address || 'TAb9uNeXzJeSWuAkiVv6d95oyZ2Jk8Qgas', 'depAddr')} style={{ width: '100%', height: '50px', borderRadius: '14px', background: 'linear-gradient(180deg,#1c8cff 0%,#0064f4 100%)', color: '#fff', border: 0, fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
            <Copy size={18} />
            {copied === 'depAddr' ? t('تم النسخ', 'Copied') : t('نسخ عنوان الإيداع', 'Copy Deposit Address')}
          </button>
        </div>

        <Note kind="info">{t('أرسل USDT عبر شبكة TRC20 فقط', 'Send USDT on TRC20 network only')}</Note>

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
          <Mark kind="usdt" size={48} />
          <div>
            <strong style={{ fontSize: '26px', fontWeight: 800, fontFamily: 'Arial, sans-serif', display: 'block', lineHeight: 1.1 }}>USDT</strong>
            <span style={{ fontSize: '13.5px', color: '#b9cdf5' }}>Tether</span>
          </div>
        </div>
      </div>

      {/* Network Selection Options */}
      <div className="fp-card" style={{ background: '#fff', border: '1px solid var(--fp-line)', borderRadius: '20px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--fp-ink)' }}>{t('شبكة التحويل', 'Transfer Network')}</h2>
        <p style={{ margin: '-4px 0 6px', fontSize: '12.5px', color: 'var(--fp-muted)' }}>{t('اختر الشبكة المستخدمة في محفظتك', 'Choose the network used by your wallet')}</p>

        <div className="fp-options" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            { id: 'usdttrc20', name: 'TRON', network: 'TRC20', icon: 'usdttrc20' },
            { id: 'usdtbsc', name: 'BNB Smart Chain', network: 'BEP20', icon: 'usdtbsc' },
            { id: 'usdteth', name: 'Ethereum', network: 'ERC20', icon: 'eth' }
          ].map(c => {
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

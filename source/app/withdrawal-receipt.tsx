'use client';
import { useState, useEffect, useRef } from 'react';
import { ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Copy, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { PAYMENT_COINS } from '@/lib/payments';
import { useOrin } from './orin-settings';
import { useNavigation } from './orin-navigation';
import './withdrawal-receipt.css';

export interface WithdrawalReceiptData {
  id: string;
  accountId?: string;
  amount: number | string;
  fee?: number | string;
  netAmount?: number | string;
  address?: string;
  coin?: string;
  currency?: string;
  network?: string;
  createdAt?: number | string | Date;
  status?: string;
  txHash?: string | null;
}

const optionalMoney = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

export function WithdrawalReceiptView({ withdrawal, onClose }: { withdrawal: WithdrawalReceiptData; onClose: () => void }) {
  const { t, prefs } = useOrin();
  const navigation = useNavigation();
  const [data, setData] = useState(withdrawal);
  const [copied, setCopied] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setData(withdrawal); }, [withdrawal]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  useEffect(() => {
    let active = true, inFlight = false;
    const refresh = async () => {
      if (inFlight || !withdrawal.id || document.hidden) return;
      inFlight = true;
      try {
        const { apiFetch } = await import('@/lib/client-api');
        const response = await apiFetch('/api/withdrawals');
        if (!response.ok) return;
        const json = await response.json();
        const match = (Array.isArray(json.items) ? json.items : []).find((item: any) =>
          item.id === withdrawal.id ||
          item.id === withdrawal.id.replace(/^(jnl-wd-|jnl-|j-wd-)/, '') ||
          withdrawal.id === item.id.replace(/^(jnl-wd-|jnl-|j-wd-)/, '')
        );
        if (active && match) {
          const cents = (snake: string, camel: string) => {
            const val = optionalMoney(match[snake] ?? match[camel]);
            return val !== undefined && Number.isSafeInteger(val) ? val / 100 : undefined;
          };
          setData(prev => ({
            ...prev,
            id: match.id || prev.id,
            accountId: match.account_id ?? match.accountId ?? prev.accountId,
            amount: cents('amount_cents', 'amountCents') ?? prev.amount,
            fee: cents('fee_cents', 'feeCents') ?? prev.fee,
            netAmount: cents('net_amount_cents', 'netAmountCents') ?? prev.netAmount,
            address: typeof match.address === 'string' && match.address ? match.address : prev.address,
            coin: typeof match.coin === 'string' ? match.coin : prev.coin,
            status: typeof match.status === 'string' ? match.status : prev.status,
            txHash: match.tx_hash ?? match.txHash ?? prev.txHash,
            createdAt: match.created_at ?? match.createdAt ?? prev.createdAt,
          }));
        }
      } catch {
        /* Keep existing view */
      } finally { inFlight = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 25000);
    return () => { active = false; clearInterval(interval); };
  }, [withdrawal.id]);

  const copy = async (value: string | undefined | null, key: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1800);
    } catch {
      /* ignore */
    }
  };

  const status = String(data.status ?? '').toLowerCase();
  const isPaid = status === 'paid' || status === 'completed' || status === 'credited';
  const isRejected = status === 'rejected' || status === 'failed';
  const isPending = !isPaid && !isRejected;

  const statusLabel = isPaid
    ? t('مكتمل', 'Completed')
    : isRejected
    ? t('مرفوض', 'Rejected')
    : status === 'approved'
    ? t('معتمد · بانتظار التحويل', 'Approved · Awaiting transfer')
    : t('قيد المراجعة', 'Under Review');

  const subtitle = isPaid
    ? t('تم تنفيذ التحويل بنجاح', 'Transfer completed successfully')
    : isRejected
    ? t('تم إلغاء أو رفض طلب السحب', 'Withdrawal request was rejected')
    : t('بانتظار تنفيذ التحويل', 'Awaiting transfer execution');

  const rawAmount = optionalMoney(data.amount) ?? 0;
  const fee = optionalMoney(data.fee) ?? Math.round(rawAmount * 5) / 100;
  const net = optionalMoney(data.netAmount) ?? Math.max(0, Math.round((rawAmount - fee) * 100) / 100);

  const coinCode = (data.coin || 'USDT').toUpperCase();
  const networkName = data.network || 'BNB Smart Chain · BEP20';

  // Format date and time
  let dateStr = '—', timeStr = '—';
  if (data.createdAt) {
    const instant = new Date(data.createdAt);
    if (Number.isFinite(instant.getTime())) {
      try {
        dateStr = new Intl.DateTimeFormat(prefs.chartLocale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: prefs.timezone
        }).format(instant);
        timeStr = new Intl.DateTimeFormat(prefs.chartLocale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: prefs.timezone
        }).format(instant);
      } catch {
        dateStr = instant.toLocaleDateString();
        timeStr = instant.toLocaleTimeString();
      }
    }
  }

  const shortAddr = (val?: string) => {
    if (!val) return '—';
    if (val.length <= 16) return val;
    return val.slice(0, 4) + '••••••••••••' + val.slice(-3);
  };

  const Back = prefs.chartLocale === 'ar' ? ArrowRight : ArrowLeft;

  return (
    <div
      ref={root}
      className="orin-withdrawal-receipt"
      dir={prefs.chartLocale === 'ar' ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wr-title"
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="wr-sheet">
        {/* Top bar with back button */}
        <header className="wr-header">
          <button type="button" className="wr-back" onClick={onClose} aria-label={t('رجوع', 'Back')}>
            <Back size={24} />
          </button>
        </header>

        {/* Hero with arrow badge, title, amount, and status pill */}
        <div className="wr-hero">
          <div className="wr-icon-bubble" aria-hidden="true">
            <ArrowUpRight size={32} />
          </div>
          <h1 id="wr-title">{t(`سحب ${coinCode}`, `Withdraw ${coinCode}`)}</h1>
          <div className="wr-amount-large" dir="ltr">
            <span className="wr-currency-symbol">{coinCode}</span>
            <span className="wr-amount-val">{rawAmount.toFixed(2)}</span>
          </div>

          <div className={`wr-status-pill ${isPaid ? 'paid' : isRejected ? 'rejected' : 'pending'}`}>
            {isPaid ? <CheckCircle2 size={18} /> : isRejected ? <CircleAlert size={18} /> : <Clock3 size={18} />}
            <span>{statusLabel}</span>
          </div>

          <p className="wr-subtitle">{subtitle}</p>
        </div>

        {/* Dashed divider */}
        <div className="wr-dashed-line" />

        {/* Section title */}
        <h2 className="wr-details-heading">{t('تفاصيل التحويل', 'Transfer Details')}</h2>

        {/* Details list */}
        <div className="wr-info-table">
          {/* Order ID */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('رقم الطلب', 'Order ID')}</span>
            <div className="wr-info-val" dir="ltr">
              <span className="wr-mono-text" title={data.id}>{data.id}</span>
              <button
                type="button"
                className="wr-copy-btn"
                onClick={() => void copy(data.id, 'id')}
                aria-label={t('نسخ رقم الطلب', 'Copy order ID')}
              >
                {copied === 'id' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          {/* Network */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('الشبكة', 'Network')}</span>
            <div className="wr-info-val">
              <span className="wr-bnb-badge">
                <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
                  <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
                  <path d="M16 6.5l3.2 3.2-4.5 4.5-4.5-4.5L16 6.5zm-5.7 5.7l1.3 1.3-3.2 3.2 3.2 3.2-1.3 1.3-4.5-4.5 4.5-4.5zm11.4 0l4.5 4.5-4.5 4.5-1.3-1.3 3.2-3.2-3.2-3.2 1.3-1.3zM16 16.5l4.5 4.5-3.2 3.2L16 21.5l-1.3 1.3-1.9-1.9 3.2-3.2v-1.2zm0-2.3l2.2-2.2 2.2 2.2-2.2 2.2L16 14.2z" fill="#fff" />
                </svg>
                <b>{networkName}</b>
              </span>
            </div>
          </div>

          {/* Date */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('التاريخ', 'Date')}</span>
            <span className="wr-info-val">{dateStr}</span>
          </div>

          {/* Time */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('الوقت', 'Time')}</span>
            <span className="wr-info-val">{timeStr}</span>
          </div>

          {/* Recipient Address */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('عنوان الاستلام', 'Recipient Address')}</span>
            <div className="wr-info-val" dir="ltr">
              <span className="wr-mono-text" title={data.address}>{shortAddr(data.address)}</span>
              {data.address && (
                <button
                  type="button"
                  className="wr-copy-btn"
                  onClick={() => void copy(data.address, 'addr')}
                  aria-label={t('نسخ عنوان الاستلام', 'Copy address')}
                >
                  {copied === 'addr' ? <Check size={16} /> : <Copy size={16} />}
                </button>
              )}
            </div>
          </div>

          {/* TxHash */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('معرّف التحويل', 'Transaction ID (TxID)')}</span>
            <div className="wr-info-val" dir="ltr">
              <span className={data.txHash ? 'wr-mono-text' : 'wr-muted-text'}>
                {data.txHash || t('لم يصدر بعد', 'Not yet issued')}
              </span>
              {data.txHash && (
                <button
                  type="button"
                  className="wr-copy-btn"
                  onClick={() => void copy(data.txHash, 'tx')}
                  aria-label={t('نسخ معرّف التحويل', 'Copy TxID')}
                >
                  {copied === 'tx' ? <Check size={16} /> : <Copy size={16} />}
                </button>
              )}
            </div>
          </div>

          {/* Withdrawal Amount */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('مبلغ السحب', 'Withdrawal Amount')}</span>
            <span className="wr-info-val wr-num-bold" dir="ltr">{rawAmount.toFixed(2)} {coinCode}</span>
          </div>

          {/* Fee */}
          <div className="wr-info-row">
            <span className="wr-info-label">{t('الرسوم', 'Fee')}</span>
            <span className="wr-info-val wr-num-bold" dir="ltr">{fee.toFixed(2)} {coinCode}</span>
          </div>
        </div>

        {/* Highlighted Net Received Box */}
        <div className="wr-net-box">
          <span className="wr-net-label">{t('صافي الاستلام', 'Net Payout')}</span>
          <strong className="wr-net-val" dir="ltr">{net.toFixed(2)} {coinCode}</strong>
        </div>

        {/* Action Button */}
        <div className="wr-action-footer">
          <button type="button" className="wr-return-btn" onClick={onClose}>
            {t('العودة إلى المعاملات', 'Return to Transactions')}
          </button>
        </div>
      </div>
    </div>
  );
}

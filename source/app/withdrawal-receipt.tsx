'use client';
import { useState, useEffect, useRef } from 'react';
import { ArrowUpRight, Wallet, CheckCircle2, CircleAlert, Clock3, Copy, Check, ArrowLeft, ArrowRight, ChevronDown, MessageCircleMore } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setData(withdrawal); setExpanded(false); setNotice(''); }, [withdrawal]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    let active = true, inFlight = false;
    const refresh = async () => {
      if (inFlight || !withdrawal.id || document.hidden) return;
      inFlight = true;
      try {
        const { apiFetch } = await import('@/lib/client-api');
        const response = await apiFetch('/api/withdrawals');
        if (!response.ok) throw new Error('unavailable');
        const json = await response.json();
        // Never match by amount, partial ID or another account's withdrawal.
        const match = (Array.isArray(json.items) ? json.items : []).find((item: any) =>
          item.id === withdrawal.id && (!withdrawal.accountId || (item.account_id ?? item.accountId) === withdrawal.accountId));
        if (active && match) {
          const cents = (snake: string, camel: string) => {
            const value = optionalMoney(match[snake] ?? match[camel]);
            return value !== undefined && Number.isSafeInteger(value) ? value / 100 : undefined;
          };
          setData(previous => ({
            ...previous,
            id: match.id,
            accountId: match.account_id ?? match.accountId ?? previous.accountId,
            amount: cents('amount_cents', 'amountCents') ?? previous.amount,
            fee: cents('fee_cents', 'feeCents'),
            netAmount: cents('net_amount_cents', 'netAmountCents'),
            address: typeof match.address === 'string' ? match.address : previous.address,
            coin: typeof match.coin === 'string' ? match.coin : previous.coin,
            currency: typeof match.currency === 'string' ? match.currency : previous.currency,
            status: typeof match.status === 'string' ? match.status : previous.status,
            txHash: match.tx_hash ?? match.txHash ?? null,
            createdAt: match.created_at ?? match.createdAt ?? previous.createdAt,
          }));
          setNotice('');
        }
      } catch {
        if (active) setNotice(t('تعذر تحديث الحالة؛ تُعرض آخر بيانات متاحة.', 'Status could not be refreshed; showing the last available data.'));
      } finally { inFlight = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 30000);
    return () => { active = false; clearInterval(interval); };
  }, [withdrawal.id, withdrawal.accountId, t]);

  const copy = async (value: string | undefined | null, key: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1800);
    } catch { setNotice(t('تعذر النسخ؛ يمكنك تحديد النص ونسخه يدويًا.', 'Could not copy; select the text and copy it manually.')); }
  };

  const status = String(data.status ?? '').toLowerCase();
  const paid = status === 'paid'; // Approval and a TxID alone never prove payment.
  const rejected = status === 'rejected' || status === 'failed';
  const pending = ['requested', 'approved', 'sending'].includes(status);
  const statusLabel = paid ? t('تم السحب', 'Withdrawal paid') : status === 'approved' ? t('معتمد · بانتظار الدفع', 'Approved · awaiting payment') : status === 'requested' ? t('قيد المراجعة', 'Under review') : status === 'sending' ? t('قيد الإرسال', 'Sending') : rejected ? t('مرفوض أو متعذر', 'Rejected or failed') : t('الحالة غير متاحة', 'Status unavailable');
  const explanation = paid ? t('تم تسجيل الدفع من الخدمة.', 'Payment is recorded by the service.') : pending ? t('لم تُسجل عملية دفع مكتملة بعد.', 'No completed payment has been recorded yet.') : rejected ? t('راجع سجل الحساب لمعرفة حالة إعادة الرصيد.', 'Check account activity for the refund status.') : t('راجع التفاصيل المتاحة أو تواصل مع الدعم.', 'Review the available details or contact support.');
  const coin = PAYMENT_COINS.find(item => item.id.toLowerCase() === (data.coin ?? '').toLowerCase());
  const currency = data.currency || 'USD'; // Receipt amounts are USD ledger amounts, not a guessed crypto conversion.
  const amount = optionalMoney(data.amount), fee = optionalMoney(data.fee), net = optionalMoney(data.netAmount);
  const money = (value: number | undefined) => value === undefined ? t('غير متاح', 'Not available') : `${value.toFixed(2)} ${currency}`;
  const short = (value?: string | null) => value ? value.length > 22 ? value.slice(0, 9) + '…' + value.slice(-7) : value : '—';
  let date = t('غير متاح', 'Not available');
  if (data.createdAt !== undefined) {
    const instant = new Date(data.createdAt);
    if (Number.isFinite(instant.getTime())) {
      try { date = new Intl.DateTimeFormat(prefs.chartLocale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { timeZone: prefs.timezone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(instant); } catch { date = instant.toISOString(); }
    }
  }
  const Back = prefs.chartLocale === 'ar' ? ArrowRight : ArrowLeft;
  const copyButton = (value: string | undefined | null, key: string, label: string) => value ? <button type="button" className="wr-copy" aria-label={label} onClick={() => void copy(value, key)}>{copied === key ? <Check size={18}/> : <Copy size={18}/>}</button> : null;

  return <div ref={root} className="orin-withdrawal-receipt" dir={prefs.chartLocale === 'ar' ? 'rtl' : 'ltr'} role="dialog" aria-modal="true" aria-labelledby="wr-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <section className="wr-sheet">
      <header className="wr-header">
        <span className="wr-brand" dir="ltr"><img src="/brand/orin-mark.png" alt="" width={38} height={38}/><strong>ORIN</strong></span>
        <button type="button" className="wr-back" onClick={onClose} aria-label={t('رجوع', 'Back')}><Back size={25}/></button>
      </header>
      <div className="wr-hero">
        <div className="wr-wallet" aria-hidden="true"><Wallet size={44}/><ArrowUpRight size={28}/></div>
        <h1 id="wr-title">{t('سحب', 'Withdrawal')}{coin ? ` ${coin.label}` : ''}</h1>
        <strong className="wr-amount" dir="ltr">{money(amount)}</strong>
        <span className={'wr-status ' + (paid ? 'paid' : rejected ? 'rejected' : 'pending')}>
          {paid ? <CheckCircle2 size={20}/> : rejected ? <CircleAlert size={20}/> : <Clock3 size={20}/>} {statusLabel}
        </span>
        <p>{explanation}</p>
      </div>
      <dl className="wr-details">
        <div><dt>{t('رقم الطلب', 'Request ID')}</dt><dd dir="ltr"><span title={data.id}>{short(data.id)}</span>{copyButton(data.id, 'id', t('نسخ رقم الطلب', 'Copy request ID'))}</dd></div>
        <div><dt>{t('تاريخ الطلب', 'Request date')}</dt><dd>{date}</dd></div>
        <div><dt>{t('الشبكة', 'Network')}</dt><dd dir="ltr">{coin?.network ?? data.network ?? t('غير متاحة', 'Not available')}</dd></div>
        <div><dt>{t('عنوان المحفظة', 'Wallet address')}</dt><dd dir="ltr"><span title={data.address}>{short(data.address)}</span>{copyButton(data.address, 'address', t('نسخ عنوان المحفظة', 'Copy wallet address'))}</dd></div>
        <div><dt>{t('الرسوم', 'Fee')}</dt><dd dir="ltr">{money(fee)}</dd></div>
        <div className="wr-net"><dt>{t('صافي الاستلام', 'Net payout')}</dt><dd dir="ltr">{money(net)}</dd></div>
      </dl>
      <button type="button" className="wr-expand" aria-expanded={expanded} aria-controls="wr-more" onClick={() => setExpanded(value => !value)}>{t('عرض المزيد من التفاصيل', 'Show more details')}<ChevronDown size={19} style={{ transform: expanded ? 'rotate(180deg)' : undefined }}/></button>
      {expanded && <dl id="wr-more" className="wr-details wr-more">
        <div><dt>{t('رقم الطلب الكامل', 'Full request ID')}</dt><dd dir="ltr">{data.id || '—'}</dd></div>
        <div><dt>{t('معرّف التحويل', 'Transaction ID')}</dt><dd dir="ltr"><span>{data.txHash || t('لم توفره الخدمة', 'Not provided by the service')}</span>{copyButton(data.txHash, 'tx', t('نسخ معرّف التحويل', 'Copy transaction ID'))}</dd></div>
        <div><dt>{t('الحالة المسجلة', 'Recorded status')}</dt><dd>{status || '—'}</dd></div>
      </dl>}
      {notice && <p className="wr-notice" role="status">{notice}</p>}
      <footer className="wr-actions">
        <button type="button" className="wr-primary" onClick={onClose}>{t('العودة إلى المعاملات', 'Return to transactions')}<Back size={22}/></button>
        <button type="button" className="wr-help" onClick={() => { onClose(); navigation.navigate('/support'); }}><MessageCircleMore size={23}/>{t('تحتاج مساعدة؟', 'Need help?')}</button>
      </footer>
    </section>
  </div>;
}

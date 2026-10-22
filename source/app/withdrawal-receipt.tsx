'use client';
import { useState, useEffect } from 'react';
import { ChevronLeft, ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Copy, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { PAYMENT_COINS } from '@/lib/payments';
import { useOrin } from './orin-settings';

export interface WithdrawalReceiptData {
  id: string;
  amount: number | string;
  fee?: number | string;
  netAmount?: number | string;
  address?: string;
  coin?: string;
  network?: string;
  createdAt?: number | string | Date;
  status?: string;
  txHash?: string | null;
}

export function WithdrawalReceiptView({
  withdrawal,
  onClose
}: {
  withdrawal: WithdrawalReceiptData;
  onClose: () => void;
}) {
  const { t, prefs } = useOrin();
  const [data, setData] = useState<WithdrawalReceiptData>(withdrawal);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setData(withdrawal);
  }, [withdrawal]);

  useEffect(() => {
    let active = true;
    const fetchFullDetails = async () => {
      try {
        const { apiFetch } = await import('@/lib/client-api');
        const res = await apiFetch('/api/withdrawals');
        if (res.ok && active) {
          const json = await res.json();
          const items = json.items || [];
          const cleanId = (withdrawal.id || '').replace(/^jnl-/, '').replace(/^wd-/, '');
          const match = items.find((item: any) => {
            const itemId = String(item.id || '').replace(/^jnl-/, '').replace(/^wd-/, '');
            if (itemId && cleanId && (itemId === cleanId || itemId.includes(cleanId) || cleanId.includes(itemId))) return true;
            const wAmt = Number(withdrawal.amount || 0);
            const itemAmt = Number(item.amount_cents || item.amountCents || 0) / 100;
            if (Math.abs(wAmt - itemAmt) < 0.01) return true;
            return false;
          });

          if (match && active) {
            setData((prev) => ({
              ...prev,
              id: match.id || prev.id,
              address: match.address || prev.address,
              coin: match.coin || prev.coin,
              status: match.status || prev.status,
              txHash: match.tx_hash || match.txHash || prev.txHash,
              amount: (match.amount_cents || match.amountCents) ? (Number(match.amount_cents || match.amountCents) / 100) : prev.amount,
              fee: (match.fee_cents || match.feeCents) ? (Number(match.fee_cents || match.feeCents) / 100) : prev.fee,
              netAmount: (match.net_amount_cents || match.netAmountCents) ? (Number(match.net_amount_cents || match.netAmountCents) / 100) : prev.netAmount,
              createdAt: match.created_at || prev.createdAt,
            }));
          }
        }
      } catch {}
    };
    if (!withdrawal.address || !withdrawal.txHash) {
      void fetchFullDetails();
    }
    return () => { active = false; };
  }, [withdrawal.id, withdrawal.address, withdrawal.txHash, withdrawal.amount]);

  const copy = (text: string, key: string) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  const userTz = typeof Intl !== 'undefined' ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : 'UTC';
  const rawDate = data.createdAt ? new Date(data.createdAt) : new Date();

  const formattedLocalDate = new Intl.DateTimeFormat(prefs.chartLocale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    timeZone: userTz,
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(rawDate);

  const formattedLocalTime = new Intl.DateTimeFormat(prefs.chartLocale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    timeZone: userTz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(rawDate);

  const status = String(data.status || 'requested').toLowerCase();
  const isPaid = status === 'paid' || status === 'approved' || status === 'completed';
  const isRejected = status === 'rejected' || status === 'failed';

  const rawAddr = data.address || '';
  const shortAddr = rawAddr.length > 18
    ? (rawAddr.slice(0, 4) + '...........' + rawAddr.slice(-3))
    : (rawAddr || '—');

  const displayId = (data.id || '').replace(/^jnl-/, '');

  const netCoin = PAYMENT_COINS.find(c => c.id.toLowerCase() === (data.coin || '').toLowerCase()) || {
    label: 'BNB Smart Chain',
    network: 'BEP20'
  };

  const numAmount = Number(data.amount || 0);
  const numFee = data.fee !== undefined ? Number(data.fee) : Math.round(numAmount * 0.05 * 100) / 100;
  const numNet = data.netAmount !== undefined ? Number(data.netAmount) : Math.max(0, numAmount - numFee);

  const Fwd = prefs.chartLocale === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#ffffff',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      }}
      dir={prefs.chartLocale === 'ar' ? 'rtl' : 'ltr'}
    >
      <section
        style={{
          width: '100%',
          maxWidth: '440px',
          margin: '0 auto',
          padding: '16px 18px 28px',
          boxSizing: 'border-box',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#ffffff'
        }}
      >
        <div>
          {/* Top Bar: Back Chevron */}
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 0 10px', width: '100%' }}>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('رجوع', 'Back')}
              style={{
                border: 0,
                background: 'none',
                color: '#0788ff',
                cursor: 'pointer',
                padding: '6px',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <ChevronLeft size={28} style={{ transform: prefs.chartLocale === 'ar' ? 'scaleX(-1)' : 'none' }} />
            </button>
          </header>

          {/* Central Circle with ArrowUpRight Icon */}
          <div style={{ textAlign: 'center', margin: '2px 0 16px' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: '#e0efff',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 12px'
              }}
            >
              <ArrowUpRight size={30} color="#0084ff" strokeWidth={2.4} />
            </div>

            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('سحب USDT', 'Withdraw USDT')}
            </div>

            <div style={{ fontSize: '38px', fontWeight: 900, color: '#09152b', margin: '4px 0 14px', fontFamily: 'Arial, sans-serif' }} dir="ltr">
              <span style={{ fontSize: '26px', fontWeight: 800, marginInlineEnd: '8px' }}>USDT</span>
              {numAmount.toFixed(2)}
            </div>

            {/* Status Pill */}
            {isPaid ? (
              <div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#dcfce7', color: '#15803d', padding: '5px 18px', borderRadius: '999px', fontSize: '13.5px', fontWeight: 700 }}>
                  <CheckCircle2 size={16} />
                  <span>{t('تم السحب', 'Withdrawn')}</span>
                </span>
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#64748b' }}>
                  {t('تم تحويل المبلغ إلى محفظتك بنجاح', 'Amount successfully transferred to your wallet')}
                </p>
              </div>
            ) : isRejected ? (
              <div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fee2e2', color: '#b91c1c', padding: '5px 18px', borderRadius: '999px', fontSize: '13.5px', fontWeight: 700 }}>
                  <CircleAlert size={16} />
                  <span>{t('مرفوض', 'Rejected')}</span>
                </span>
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#64748b' }}>
                  {t('تم رفض طلب السحب وإعادة الرصيد', 'Withdrawal rejected and refunded')}
                </p>
              </div>
            ) : (
              <div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef3c7', color: '#b45309', padding: '5px 18px', borderRadius: '999px', fontSize: '13.5px', fontWeight: 700 }}>
                  <Clock3 size={16} />
                  <span>{t('قيد المراجعة', 'Under Review')}</span>
                </span>
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#64748b' }}>
                  {t('بانتظار تنفيذ التحويل', 'Awaiting transfer execution')}
                </p>
              </div>
            )}
          </div>

          {/* Dashed Divider */}
          <div style={{ borderTop: '1px dashed #e2e8f0', margin: '22px 0 16px' }} />

          {/* Section Title */}
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#09152b', textAlign: 'start', margin: '0 0 14px' }}>
            {t('تفاصيل التحويل', 'Transfer Details')}
          </div>

          {/* Key-Value Details */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Row 1: Order ID */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '13.5px' }}>
              <span style={{ color: '#64748b', fontWeight: 500, minWidth: '70px', textAlign: 'end' }}>
                {t('رقم الطلب', 'Order ID')}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#0f172a', maxWidth: '75%', wordBreak: 'break-all' }} dir="ltr">
                <span>{displayId}</span>
                <button
                  type="button"
                  onClick={() => copy(displayId, 'wdId')}
                  aria-label={t('نسخ رقم الطلب', 'Copy Order ID')}
                  style={{ border: 0, background: 'none', cursor: 'pointer', padding: '2px', color: '#0788ff', display: 'grid', placeItems: 'center', flexShrink: 0 }}
                >
                  {copied === 'wdId' ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </span>
            </div>

            {/* Row 2: Network */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>
                {t('الشبكة', 'Network')}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#0f172a' }} dir="ltr">
                <span
                  style={{
                    width: 22,
                    height: 22,
                    background: '#f3ba2f',
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0
                  }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="#fff">
                    <path d="M12 3.2 14.6 5.8 12 8.4 9.4 5.8ZM6.3 8.9 8.9 11.5 6.3 14.1 3.7 11.5ZM17.7 8.9 20.3 11.5 17.7 14.1 15.1 11.5ZM12 9.1 14.6 11.7 12 14.3 9.4 11.7ZM12 14.9 14.6 17.5 12 20.1 9.4 17.5Z" />
                  </svg>
                </span>
                <span>{netCoin.label} · {netCoin.network}</span>
              </span>
            </div>

            {/* Row 3: Date */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>
                {t('التاريخ', 'Date')}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a' }} dir="auto">
                {formattedLocalDate}
              </span>
            </div>

            {/* Row 4: Time */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>
                {t('الوقت', 'Time')}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a' }} dir="ltr">
                {formattedLocalTime}
              </span>
            </div>

            {/* Row 5: Recipient Address */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>
                {t('عنوان الاستلام', 'Recipient Address')}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#0f172a' }} dir="ltr">
                <span>{shortAddr}</span>
                <button
                  type="button"
                  onClick={() => copy(rawAddr || shortAddr, 'wdAddr')}
                  aria-label={t('نسخ عنوان الاستلام', 'Copy Recipient Address')}
                  style={{ border: 0, background: 'none', cursor: 'pointer', padding: '2px', color: '#0788ff', display: 'grid', placeItems: 'center', flexShrink: 0 }}
                >
                  {copied === 'wdAddr' ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </span>
            </div>

            {/* Row 6: Transfer TxID */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>
                {t('معرّف التحويل', 'Transaction Hash')}
              </span>
              <span style={{ fontWeight: 600, color: data.txHash ? '#0f172a' : '#94a3b8' }} dir="ltr">
                {data.txHash ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{data.txHash.length > 20 ? data.txHash.slice(0, 8) + '...' + data.txHash.slice(-6) : data.txHash}</span>
                    <button
                      type="button"
                      onClick={() => copy(data.txHash!, 'wdTx')}
                      aria-label={t('نسخ معرّف التحويل', 'Copy Tx Hash')}
                      style={{ border: 0, background: 'none', cursor: 'pointer', padding: '2px', color: '#0788ff', display: 'grid', placeItems: 'center' }}
                    >
                      {copied === 'wdTx' ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </span>
                ) : t('لم يصدر بعد', 'Not issued yet')}
              </span>
            </div>
          </div>

          {/* Solid Divider */}
          <div style={{ borderTop: '1px solid #f1f5f9', margin: '16px 0 12px' }} />

          {/* Amounts & Fees rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>
                {t('مبلغ السحب', 'Withdrawal Amount')}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a', fontFamily: 'Arial, sans-serif' }} dir="ltr">
                {numAmount.toFixed(2)} USDT
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>
                {t('الرسوم', 'Fees')}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a', fontFamily: 'Arial, sans-serif' }} dir="ltr">
                {numFee.toFixed(2)} USDT
              </span>
            </div>
          </div>

          {/* Highlighted Light Blue Container for Net Received */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#eaf2ff', borderRadius: '16px', padding: '16px 20px', marginTop: '16px' }}>
            <span style={{ fontSize: '15.5px', fontWeight: 800, color: '#004080' }}>
              {t('صافي الاستلام', 'Net Received')}
            </span>
            <strong style={{ fontSize: '20px', fontWeight: 900, color: '#0066cc', fontFamily: 'Arial, sans-serif' }} dir="ltr">
              {numNet.toFixed(2)} USDT
            </strong>
          </div>
        </div>

        {/* Bottom Actions */}
        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
          <button
            type="button"
            className="fp-btn primary big"
            onClick={onClose}
            style={{
              width: '100%',
              height: '52px',
              borderRadius: '16px',
              background: '#0788ff',
              color: '#fff',
              fontSize: '16px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              border: 0,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(7, 136, 255, 0.35)'
            }}
          >
            <span>{t('العودة إلى المعاملات', 'Return to Transactions')}</span>
            <Fwd size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}

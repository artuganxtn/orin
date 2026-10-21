'use client';
import { useState, useEffect } from 'react';
import { ArrowDownUp, Info, CheckCircle2, History } from 'lucide-react';
import type { TradingAccount } from '@/lib/trading-accounts';
import { useOrin } from './orin-settings';
import { toast } from 'sonner';
import { demoWalletRequest } from '@/lib/demo-wallet-client';
import type { DemoWalletView } from '@/lib/demo-wallet';
import './account-workflows.css';

export function AccountTransfer({ account, onSaved }: { account: TradingAccount | null; onSaved: () => Promise<void> }) {
  const { t, number } = useOrin();
  const [from, setFrom] = useState<'futures' | 'perpetual'>('futures');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [walletView, setWalletView] = useState<DemoWalletView | null>(null);
  const [loading, setLoading] = useState(false);

  const to = from === 'futures' ? 'perpetual' : 'futures';
  const label = (type: string) => type === 'futures' ? t('الرصيد المتاح للسحب (العقود الآجلة)', 'Available for Withdrawal (Futures)') : t('رصيد العقود الدائمة (للتداول فقط - غير قابل للسحب)', 'Permanent Contracts (Trading Only - Non-Withdrawable)');

  // Load live wallet pockets and history on mount and when account changes
  useEffect(() => {
    let mounted = true;
    if (!account?.id) {
      setWalletView(null);
      return;
    }
    setLoading(true);
    demoWalletRequest(account.id)
      .then(res => {
        if (mounted) setWalletView(res);
      })
      .catch(err => {
        console.warn('Failed to fetch wallet status', err);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [account?.id]);

  const futuresBal = (walletView?.wallet?.futuresCents ?? account?.balanceCents ?? 0) / 100;
  const perpBal = (walletView?.wallet?.perpetualCents ?? 0) / 100;
  const availableBal = from === 'futures' ? futuresBal : perpBal;
  const maxAmount = availableBal > 0 ? availableBal.toFixed(2) : '0';

  async function submit() {
    if (!account?.id) {
      toast.error(t('يرجى اختيار حساب تداول أولاً.', 'Please select a trading account first.'));
      return;
    }
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      toast.error(t('أدخل مبلغ تحويل صالحًا.', 'Enter a valid transfer amount.'));
      return;
    }
    if (val > availableBal) {
      toast.error(t('الرصيد المتاح غير كافٍ للتحويل.', 'Insufficient available balance.'));
      return;
    }

    setBusy(true);
    try {
      const amountCents = Math.round(val * 100);
      const reqId = 'TR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const updated = await demoWalletRequest(account.id, {
        requestId: reqId,
        kind: 'transfer',
        amountCents,
        from
      });
      setWalletView(updated);
      setDone(reqId);
      setAmount('');
      toast.success(t('تم التحويل بنجاح بين العقود!', 'Transfer completed successfully!'));
      await onSaved();
    } catch (e: any) {
      toast.error(e.message || t('تعذر إتمام التحويل.', 'Failed to complete transfer.'));
    } finally {
      setBusy(false);
    }
  }

  const operations = walletView?.operations || [];

  if (showHistory) {
    return (
      <section className="account-transfer" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', width: '100%', boxSizing: 'border-box' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--orin-ink)' }}>{t('سجل التحويلات', 'Transfer History')}</h2>
          <button type="button" className="btn-outline" onClick={() => setShowHistory(false)} style={{ fontSize: '13px', padding: '6px 12px' }}>
            {t('العودة للتحويل', 'Back to Transfer')}
          </button>
        </div>

        {operations.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', boxSizing: 'border-box' }}>
            {operations.map(op => (
              <div key={op.id} style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '16px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', width: '100%', boxSizing: 'border-box' }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: '14.5px', color: 'var(--orin-ink)' }}>
                    {label(op.from)} ← {label(op.to)}
                  </b>
                  <small style={{ color: 'var(--orin-muted)', fontSize: '12px' }}>
                    {new Date(op.createdAt).toLocaleDateString('ar-SA')} · {op.id}
                  </small>
                </div>
                <span style={{ color: '#0788ff', fontWeight: 700, fontSize: '15px' }} dir="ltr">
                  {(op.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--orin-muted)', fontSize: '14px' }}>
            {t('لا توجد تحويلات مسجلة مسبقًا.', 'No previous transfers recorded.')}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="account-transfer" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
      {/* Header Info Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--orin-ink)' }}>{t('التحويل بين العقود', 'Transfer Between Contracts')}</h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--orin-muted)' }}>{t('اختر نوعي العقود وحدد مبلغ التحويل', 'Select contract types and enter amount')}</p>
        </div>

        <button type="button" onClick={() => setShowHistory(true)} style={{ border: 0, background: 'none', color: '#0788ff', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexShrink: 0 }}>
          <History size={16} />
          {t('سجل التحويلات', 'Transfer History')} ({operations.length})
        </button>
      </div>

      {/* From / To Direction Selector Card */}
      <div style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '20px', padding: '16px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', boxSizing: 'border-box' }}>
        {/* Swap Direction Button */}
        <button
          type="button"
          onClick={() => setFrom(to)}
          aria-label={t('عكس اتجاه التحويل', 'Swap direction')}
          style={{ position: 'absolute', insetInlineStart: '16px', top: '50%', transform: 'translateY(-50%)', width: '40px', height: '40px', borderRadius: '50%', background: '#fff', border: '1.5px solid #dbe4f2', display: 'grid', placeItems: 'center', color: '#0788ff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(7,136,255,0.15)', zIndex: 2 }}
        >
          <ArrowDownUp size={18} />
        </button>

        {/* From Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingInlineStart: '52px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
            <small style={{ fontSize: '12.5px', color: 'var(--orin-muted)' }}>{t('من', 'From')}</small>
            <small style={{ fontSize: '12.5px', color: '#0788ff', fontWeight: 600 }} dir="ltr">
              {t('المتاح', 'Available')}: {availableBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
            </small>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#0788ff', display: 'inline-block', flexShrink: 0 }} />
            <strong style={{ fontSize: '16px', color: 'var(--orin-ink)', fontWeight: 700 }}>{label(from)}</strong>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--orin-line)', margin: '0' }} />

        {/* To Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingInlineStart: '52px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
            <small style={{ fontSize: '12.5px', color: 'var(--orin-muted)' }}>{t('إلى', 'To')}</small>
            <small style={{ fontSize: '12.5px', color: 'var(--orin-muted)' }} dir="ltr">
              {t('الرصيد الحالي', 'Current')}: {(from === 'futures' ? perpBal : futuresBal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
            </small>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#00d2c8', display: 'inline-block', flexShrink: 0 }} />
            <strong style={{ fontSize: '16px', color: 'var(--orin-ink)', fontWeight: 700 }}>{label(to)}</strong>
          </div>
        </div>
      </div>

      {/* Currency Selector Card */}
      <div style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '16px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', boxSizing: 'border-box' }}>
        <small style={{ fontSize: '13px', color: 'var(--orin-muted)' }}>{t('العملة', 'Currency')}</small>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#26a17b', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '14px' }}>₮</span>
          <b style={{ fontSize: '16px', fontWeight: 700, color: 'var(--orin-ink)', fontFamily: 'Arial, sans-serif' }}>USDT</b>
        </div>
      </div>

      {/* Amount Input Field */}
      <div style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
        <small style={{ fontSize: '13px', color: 'var(--orin-muted)' }}>{t('مبلغ التحويل', 'Transfer Amount')}</small>
        <div style={{ display: 'flex', alignItems: 'center', height: '50px', border: '1px solid #dbe4f2', borderRadius: '12px', overflow: 'hidden', background: 'var(--orin-surface-soft)', width: '100%', boxSizing: 'border-box' }}>
          <input
            inputMode="decimal"
            dir="ltr"
            placeholder={t('أدخل المبلغ', 'Enter amount')}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', padding: '0 14px', fontSize: '16px', color: 'var(--orin-ink)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', background: '#eef4fc', height: '100%', borderInlineStart: '1px solid #dbe4f2', flexShrink: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#4a5d7f' }}>USDT</span>
            <button
              type="button"
              onClick={() => setAmount(maxAmount)}
              style={{ border: 0, background: '#0788ff', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              {t('الكل', 'All')}
            </button>
          </div>
        </div>
      </div>

      {/* 20% Early Exit Calculation when transferring from Perpetual to Futures */}
      {from === 'perpetual' && Number(amount) > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 16px', borderRadius: '16px', background: '#fffbeb', border: '1px solid #fde68a', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#92400e', fontWeight: 600 }}>{t('المبلغ المحوّل من العقود الدائمة:', 'Transfer Amount from Perpetual:')}</span>
            <b dir="ltr" style={{ color: '#0f172a' }}>{Number(amount).toFixed(2)} USDT</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#92400e', fontWeight: 600 }}>{t('رسوم الانسحاب المبكر (20% قبل 29 يوماً):', 'Early Exit Fee (20% before 29 days):')}</span>
            <b dir="ltr" style={{ color: '#dc2626', fontWeight: 700 }}>-{(Number(amount) * 0.20).toFixed(2)} USDT</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #fcd34d', paddingTop: '8px' }}>
            <span style={{ color: '#92400e', fontWeight: 800, fontSize: '13.5px' }}>{t('الصافي الواصل لمحفظة السحب (العقود الآجلة):', 'Net Credited to Withdrawable Futures:')}</span>
            <b dir="ltr" style={{ color: '#0788ff', fontSize: '15px', fontWeight: 800 }}>{(Number(amount) * 0.80).toFixed(2)} USDT</b>
          </div>
        </div>
      )}

      {/* Direction-specific Policy Alert */}
      {from === 'perpetual' ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '14px 16px', borderRadius: '16px', background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', fontSize: '13px', lineHeight: 1.6, width: '100%', boxSizing: 'border-box' }}>
          <Info size={19} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ minWidth: 0 }}>
            <b style={{ display: 'block', fontSize: '14px', marginBottom: '3px' }}>
              {t('سياسة الانسحاب المبكر (20% قبل 29 يوماً)', 'Early Exit Policy (20% before 29 days)')}
            </b>
            <span>
              {t('العقود الدائمة مخصصة للتداول حصراً وغير قابلة للسحب مباشرة. عند نقل الرصيد إلى محفظة السحب (العقود الآجلة) قبل استيفاء مدة الـ 29 يوماً، تُفرض رسوم انسحاب مبكر بنسبة 20% وفق سياسة إدارة رأس المال المعتمدة.', 'Permanent Contracts are for trading only and not directly withdrawable. Transferring to Withdrawable Futures before 29 days incurs a 20% early exit fee per capital management policy.')}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderRadius: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}>
          <CheckCircle2 size={19} style={{ color: '#16a34a', flexShrink: 0 }} />
          <span><b>{t('تمويل التداول فوري ومجاني (0% رسوم)', 'Trading Funding is Free (0% Fee)')}</b> · {t('نقل الرصيد من العقود الآجلة إلى العقود الدائمة لفتح صفقات التداول مجاني وفوري 100%.', 'Transferring funds from Futures to Permanent Contracts to open trades is 100% free and instant.')}</span>
        </div>
      )}

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', background: '#e8f8f1', border: '1px solid #bfe9d6', color: '#11795a', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}>
          <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          <span><b>{t('تم التحويل بنجاح', 'Transfer Successful')}</b> · {done}</span>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="button"
        className="btn-primary"
        disabled={busy || !amount || Number(amount) <= 0 || loading || availableBal <= 0}
        onClick={submit}
        style={{ width: '100%', height: '52px', borderRadius: '16px', background: (availableBal <= 0) ? '#94a3b8' : 'linear-gradient(180deg,#1c8cff 0%,#0064f4 100%)', color: '#fff', border: 0, fontSize: '16px', fontWeight: 700, cursor: (busy || availableBal <= 0) ? 'not-allowed' : 'pointer', opacity: (busy || availableBal <= 0) ? 0.65 : 1, boxShadow: (availableBal <= 0) ? 'none' : '0 10px 22px rgba(10,108,255,0.25)', boxSizing: 'border-box' }}
      >
        {busy ? t('جار التحويل…', 'Transferring…') : availableBal <= 0 ? t('الرصيد غير كافٍ للتحويل', 'Insufficient Balance') : t('متابعة التحويل', 'Continue Transfer')}
      </button>

      <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--orin-muted)', margin: 0 }}>
        {t('راجع التفاصيل قبل التأكيد', 'Review details before confirmation')}
      </p>
    </section>
  );
}

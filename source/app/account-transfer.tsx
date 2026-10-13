'use client';
import { useState } from 'react';
import { ArrowDownUp, Info, CheckCircle2, History } from 'lucide-react';
import type { TradingAccount } from '@/lib/trading-accounts';
import { useOrin } from './orin-settings';
import { toast } from 'sonner';
import './account-workflows.css';

export function AccountTransfer({ account, onSaved }: { account: TradingAccount | null; onSaved: () => Promise<void> }) {
  const { t, number } = useOrin();
  const [from, setFrom] = useState<'futures' | 'perpetual'>('futures');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const to = from === 'futures' ? 'perpetual' : 'futures';
  const label = (type: 'futures' | 'perpetual') => type === 'futures' ? t('العقود الآجلة', 'Futures Contracts') : t('العقود الدائمة', 'Perpetual Contracts');

  const maxAmount = '1000';

  async function submit() {
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      toast.error(t('أدخل مبلغ تحويل صالحًا.', 'Enter a valid transfer amount.'));
      return;
    }
    setBusy(true);
    try {
      await new Promise(r => setTimeout(r, 800));
      const refId = 'TR-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      setDone(refId);
      setAmount('');
      toast.success(t('تم التحويل بنجاح بين العقود!', 'Transfer completed successfully!'));
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (showHistory) {
    return (
      <section className="account-transfer" style={{ padding: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--orin-ink)' }}>{t('سجل التحويلات', 'Transfer History')}</h2>
          <button type="button" className="btn-outline" onClick={() => setShowHistory(false)} style={{ fontSize: '13px', padding: '6px 12px' }}>
            {t('العودة للتحويل', 'Back to Transfer')}
          </button>
        </div>

        {done ? (
          <div style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '16px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <b style={{ display: 'block', fontSize: '15px', color: 'var(--orin-ink)' }}>{label('futures')} ← {label('perpetual')}</b>
              <small style={{ color: 'var(--orin-muted)', fontSize: '12px' }}>{new Date().toLocaleDateString('ar-SA')} · {done}</small>
            </div>
            <span style={{ color: '#0788ff', fontWeight: 700, fontSize: '16px' }} dir="ltr">1,000.00 USDT</span>
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
    <section className="account-transfer" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px' }}>
      {/* Header Info Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--orin-ink)' }}>{t('التحويل بين العقود', 'Transfer Between Contracts')}</h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--orin-muted)' }}>{t('اختر نوعي العقود وحدد مبلغ التحويل', 'Select contract types and enter amount')}</p>
        </div>

        <button type="button" onClick={() => setShowHistory(true)} style={{ border: 0, background: 'none', color: '#0788ff', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <History size={16} />
          {t('سجل التحويلات', 'Transfer History')}
        </button>
      </div>

      {/* From / To Direction Selector Card */}
      <div style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '20px', padding: '20px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Swap Direction Button */}
        <button
          type="button"
          onClick={() => setFrom(to)}
          aria-label={t('عكس اتجاه التحويل', 'Swap direction')}
          style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', width: '42px', height: '42px', borderRadius: '50%', background: '#fff', border: '1.5px solid #dbe4f2', display: 'grid', placeItems: 'center', color: '#0788ff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(7,136,255,0.15)', zIndex: 2 }}
        >
          <ArrowDownUp size={18} />
        </button>

        {/* From Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingEnd: '50px' }}>
          <small style={{ fontSize: '12.5px', color: 'var(--orin-muted)' }}>{t('من', 'From')}</small>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#0788ff', display: 'inline-block' }} />
            <strong style={{ fontSize: '17px', color: 'var(--orin-ink)', fontWeight: 700 }}>{label(from)}</strong>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--orin-line)', margin: '0' }} />

        {/* To Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingEnd: '50px' }}>
          <small style={{ fontSize: '12.5px', color: 'var(--orin-muted)' }}>{t('إلى', 'To')}</small>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#00d2c8', display: 'inline-block' }} />
            <strong style={{ fontSize: '17px', color: 'var(--orin-ink)', fontWeight: 700 }}>{label(to)}</strong>
          </div>
        </div>
      </div>

      {/* Currency Selector Card */}
      <div style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '16px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <small style={{ fontSize: '13px', color: 'var(--orin-muted)' }}>{t('العملة', 'Currency')}</small>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#26a17b', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '14px' }}>₮</span>
          <b style={{ fontSize: '16px', fontWeight: 700, color: 'var(--orin-ink)', fontFamily: 'Arial, sans-serif' }}>USDT</b>
        </div>
      </div>

      {/* Amount Input Field */}
      <div style={{ background: '#fff', border: '1px solid var(--orin-line)', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <small style={{ fontSize: '13px', color: 'var(--orin-muted)' }}>{t('مبلغ التحويل', 'Transfer Amount')}</small>
        <div style={{ display: 'flex', alignItems: 'center', height: '50px', border: '1px solid #dbe4f2', borderRadius: '12px', overflow: 'hidden', background: 'var(--orin-surface-soft)' }}>
          <input
            inputMode="decimal"
            dir="ltr"
            placeholder={t('أدخل المبلغ', 'Enter amount')}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ flex: 1, border: 0, background: 'transparent', outline: 'none', padding: '0 14px', fontSize: '16px' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', background: '#eef4fc', height: '100%', borderInlineStart: '1px solid #dbe4f2' }}>
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

      {/* Info Alert */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', background: '#edf5ff', border: '1px solid #d6e7fc', color: '#3f5a82', fontSize: '13px', lineHeight: 1.6 }}>
        <Info size={18} style={{ color: '#0788ff', flex: 'none' }} />
        <div>
          <b style={{ display: 'block', fontSize: '13.5px', marginBottom: '2px' }}>{t('معلومات التحويل', 'Transfer Info')}</b>
          <span>{t('حدد نوع العقود المحوّل منه وإليه، ثم أدخل المبلغ.', 'Select transfer source & destination, then enter amount.')}</span>
        </div>
      </div>

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', background: '#e8f8f1', border: '1px solid #bfe9d6', color: '#11795a', fontSize: '13px' }}>
          <CheckCircle2 size={18} style={{ flex: 'none' }} />
          <span><b>{t('تم التحويل بنجاح', 'Transfer Successful')}</b> · {done}</span>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="button"
        className="btn-primary"
        disabled={busy || !amount}
        onClick={submit}
        style={{ width: '100%', height: '52px', borderRadius: '16px', background: 'linear-gradient(180deg,#1c8cff 0%,#0064f4 100%)', color: '#fff', border: 0, fontSize: '16px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 10px 22px rgba(10,108,255,0.25)' }}
      >
        {busy ? t('جار التحويل…', 'Transferring…') : t('متابعة التحويل', 'Continue Transfer')}
      </button>

      <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--orin-muted)', margin: 0 }}>
        {t('راجع التفاصيل قبل التأكيد', 'Review details before confirmation')}
      </p>
    </section>
  );
}

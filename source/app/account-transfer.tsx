'use client';
import { useState, useEffect, useRef } from 'react';
import { ArrowDownUp, Info, CheckCircle2, History } from 'lucide-react';
import type { TradingAccount } from '@/lib/trading-accounts';
import { useOrin } from './orin-settings';
import { toast } from 'sonner';
import { demoWalletRequest } from '@/lib/demo-wallet-client';
import { parseUsdAmount, type DemoWalletView, type TransferQuote } from '@/lib/demo-wallet';
import { transferAmounts } from '@/lib/financial-policy';
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
  const [pendingQuote, setPendingQuote] = useState<TransferQuote | null>(null);
  const submitting = useRef(false);
  const requestId = useRef<string | null>(null);
  const currentAccountId = useRef(account?.id);
  currentAccountId.current = account?.id;

  const to = from === 'futures' ? 'perpetual' : 'futures';
  const label = (type: string) => type === 'futures' ? t('الرصيد المتاح للسحب (العقود الآجلة)', 'Available for Withdrawal (Futures)') : t('رصيد العقود الدائمة (للتداول فقط - غير قابل للسحب)', 'Permanent Contracts (Trading Only - Non-Withdrawable)');

  // Load live wallet pockets and history on mount and when account changes
  useEffect(() => {
    let mounted = true;
    setPendingQuote(null);
    setWalletView(null);
    setDone(null);
    setAmount('');
    requestId.current = null;
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
  const signalPolicyActive = walletView?.financialPolicy?.version === 'signal-doubling-v1';
  const activeFeeRate = from === 'futures' || account?.type === 'demo' ? 0 : signalPolicyActive ? undefined : walletView?.challenge?.transferFeeRate;
  const previewCents = Math.round(Number(amount) * 100);
  const preview = pendingQuote ?? (Number.isSafeInteger(previewCents) && previewCents > 0 && activeFeeRate !== undefined
    ? transferAmounts(previewCents, activeFeeRate) : null);

  function cancelReview() {
    setPendingQuote(null);
    requestId.current = null;
  }

  async function submit() {
    if (submitting.current) return;
    if (!account?.id) {
      toast.error(t('يرجى اختيار حساب تداول أولاً.', 'Please select a trading account first.'));
      return;
    }
    let amountCents: number;
    try {
      if (account.type === 'demo') amountCents = parseUsdAmount(amount);
      else {
        const text = amount.trim().replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace('٫', '.');
        if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid cents');
        const [whole, fraction = ''] = text.split('.');
        amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        if (!Number.isSafeInteger(amountCents)) throw new Error('Invalid cents');
      }
    } catch {
      toast.error(t('أدخل مبلغ تحويل صالحًا.', 'Enter a valid transfer amount.'));
      return;
    }
    if (amountCents <= 0 || amountCents > Math.round(availableBal * 100)) {
      toast.error(t('الرصيد المتاح غير كافٍ للتحويل.', 'Insufficient available balance.'));
      return;
    }

    submitting.current = true;
    setBusy(true);
    const accountId = account.id;
    try {
      requestId.current ??= 'TR-' + crypto.randomUUID();
      const reqId = requestId.current;
      const updated = await demoWalletRequest(accountId, {
        requestId: reqId,
        kind: pendingQuote ? 'transfer' : 'quote',
        amountCents,
        from,
        ...(pendingQuote ? { confirmedQuote: pendingQuote } : {})
      });
      if (currentAccountId.current !== accountId) return;
      setWalletView(updated);
      if (!pendingQuote) {
        if (!updated.transferQuote) throw new Error(t('تعذر جلب تفاصيل التحويل. حاول مجددًا.', 'Unable to quote this transfer. Please retry.'));
        setPendingQuote(updated.transferQuote);
        return;
      }
      setDone(reqId);
      setPendingQuote(null);
      requestId.current = null;
      setAmount('');
      toast.success(t('تم التحويل بنجاح بين العقود!', 'Transfer completed successfully!'));
      await onSaved();
    } catch (e: any) {
      if (e.status === 409) setPendingQuote(null);
      toast.error(e.message || t('تعذر إتمام التحويل.', 'Failed to complete transfer.'));
    } finally {
      submitting.current = false;
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
          disabled={busy}
          onClick={() => { cancelReview(); setFrom(to); }}
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
            disabled={busy}
            onChange={e => { cancelReview(); setAmount(e.target.value); }}
            style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', padding: '0 14px', fontSize: '16px', color: 'var(--orin-ink)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', background: '#eef4fc', height: '100%', borderInlineStart: '1px solid #dbe4f2', flexShrink: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#4a5d7f' }}>USDT</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => { cancelReview(); setAmount(maxAmount); }}
              style={{ border: 0, background: '#0788ff', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              {t('الكل', 'All')}
            </button>
          </div>
        </div>
      </div>

      {/* Integer-cent preview; confirmation uses the server's current quote. */}
      {preview && (from === 'perpetual' || pendingQuote) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 16px', borderRadius: '16px', background: '#fffbeb', border: '1px solid #fde68a', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#92400e', fontWeight: 600 }}>{t('مبلغ التحويل:', 'Transfer amount:')}</span>
            <b dir="ltr" style={{ color: '#0f172a' }}>{(preview.amountCents / 100).toFixed(2)} USDT</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#92400e', fontWeight: 600 }}>{t('رسوم التحويل:', 'Transfer fee:')}{!signalPolicyActive && ` (${Math.round(preview.feeRate * 100)}%)`}</span>
            <b dir="ltr" style={{ color: '#dc2626', fontWeight: 700 }}>-{(preview.feeCents / 100).toFixed(2)} USDT</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #fcd34d', paddingTop: '8px' }}>
            <span style={{ color: '#92400e', fontWeight: 800, fontSize: '13.5px' }}>{t('الصافي الواصل للمحفظة المستلمة:', 'Net credited to receiving wallet:')}</span>
            <b dir="ltr" style={{ color: '#0788ff', fontSize: '15px', fontWeight: 800 }}>{(preview.netAmountCents / 100).toFixed(2)} USDT</b>
          </div>
          {pendingQuote && signalPolicyActive && Number(pendingQuote.legacyAmountCents) > 0 && <small>{t('يتضمن العرض رصيدًا قديمًا؛ حُسبت رسومه وفق شروطه الأصلية، وليس وفق شرط الإيداعات الجديدة.', 'This quote includes grandfathered funds; their fee follows the original terms, not the new-deposit condition.')}</small>}
          {pendingQuote && signalPolicyActive && from === 'perpetual' && !pendingQuote.permanentlyExempt && Number(pendingQuote.policyAmountCents) > 0 && <small>{t('تُجمع كسور سنت رسوم 20% حتى تكتمل؛ قد يتضمن هذا العرض كسرًا متبقيًا من تحويل سابق. الرسم والصافي أعلاه هما المبلغان الفعليان.', 'Fractional cents of the 20% fee carry forward until a full cent accrues. This quote may include a fraction from an earlier transfer. The fee and net above are the actual amounts.')}</small>}
        </div>
      )}

      {/* Direction-specific Policy Alert */}
      {from === 'perpetual' ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '14px 16px', borderRadius: '16px', background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', fontSize: '13px', lineHeight: 1.6, width: '100%', boxSizing: 'border-box' }}>
          <Info size={19} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ minWidth: 0 }}>
            <b style={{ display: 'block', fontSize: '14px', marginBottom: '3px' }}>
              {t('راجع رسوم التحويل قبل التأكيد', 'Review transfer fees before confirming')}
            </b>
            <span>
              {account?.type === 'demo'
                ? t('التحويل التجريبي مجاني ولا يمثل أموالًا قابلة للسحب.', 'Demo transfers are free and do not represent withdrawable money.')
                : signalPolicyActive
                  ? walletView?.signalPolicy?.permanentlyExemptAt != null
                    ? t('حسابك معفى نهائيًا من رسوم التحويل المبكر، ويشمل الإعفاء الإيداعات اللاحقة. رسوم السحب الخارجي 5% تبقى منفصلة.', 'Your account is permanently exempt from early-transfer fees, including later deposits. The separate 5% external withdrawal fee still applies.')
                    : t('رسوم نقل الإيداعات الجديدة من التداول إلى المحفظة الفورية 20% حتى يساوي صافي الربح المحقق من الإشارات مجموع الإيداعات الجديدة. عند تحقق الشرط يُعفى الحساب نهائيًا، حتى للإيداعات اللاحقة. رسوم السحب الخارجي 5% منفصلة. راجع العرض الفعلي قبل التأكيد.', 'Transferring new-deposit funds from trading to spot costs 20% until net realized signal profit equals aggregate new deposits. Qualification permanently waives that fee, including future deposits. External withdrawal has a separate 5% fee. Review the actual quote before confirming.')
                  : t('السياسة الحالية: رسوم 20% قبل مرور 29 يومًا من أول إيداع مؤكد، ثم 0%. يعرض التأكيد الرسوم الفعلية والصافي. رسوم السحب الخارجي 5% منفصلة.', 'Current policy: 20% before 29 days from the first confirmed deposit, then 0%. Confirmation shows the actual fee and net amount. External withdrawal has a separate 5% fee.')}
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
        {busy ? t('جار المعالجة…', 'Processing…') : availableBal <= 0 ? t('الرصيد غير كافٍ للتحويل', 'Insufficient Balance') : pendingQuote ? t('تأكيد التحويل بالرسوم الموضحة', 'Confirm transfer with shown fees') : t('متابعة التحويل', 'Continue Transfer')}
      </button>
      {pendingQuote && <button type="button" className="btn-outline" disabled={busy} onClick={cancelReview}>{t('إلغاء', 'Cancel')}</button>}

      <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--orin-muted)', margin: 0 }}>
        {t('راجع التفاصيل قبل التأكيد', 'Review details before confirmation')}
      </p>
    </section>
  );
}

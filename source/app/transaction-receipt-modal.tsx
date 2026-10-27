'use client';
import { useState, useRef, useEffect } from 'react';
import { 
  ChevronRight, 
  ChevronLeft, 
  Copy, 
  Check, 
  ExternalLink, 
  Headphones, 
  Wallet, 
  ArrowDownLeft, 
  ArrowUpRight, 
  ArrowLeftRight, 
  CheckCircle2, 
  Clock3, 
  CircleAlert, 
  Info,
  ShieldCheck
} from 'lucide-react';
import { useOrin } from './orin-settings';
import { useNavigation } from './orin-navigation';
import type { AccountTransaction } from '@/lib/account-transactions';
import './transaction-receipt-modal.css';

export interface UnifiedTransactionData {
  id: string;
  kind: 'settlement' | 'deposit' | 'withdrawal' | 'allocation' | string;
  status: string;
  amount: number;
  principalAmount?: number;
  profitAmount?: number;
  currency: string;
  accountNumber: string;
  createdAt: number;
  orderId?: string;
  relatedTradeId?: string;
  paymentRef?: string;
  paymentUrl?: string;
  coin?: string;
  network?: string;
  address?: string;
  txHash?: string | null;
}

export function TransactionReceiptModal({ 
  transaction, 
  onClose,
  onOpenTrade
}: { 
  transaction: UnifiedTransactionData; 
  onClose: () => void;
  onOpenTrade?: (tradeId: string) => void;
}) {
  const { t, prefs, number } = useOrin();
  const navigation = useNavigation();
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

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

  const isAr = prefs.chartLocale === 'ar';
  const BackChevron = isAr ? ChevronRight : ChevronLeft;
  const ForwardChevron = isAr ? ChevronLeft : ChevronRight;

  const formatDate = (ts: number) => {
    try {
      return new Intl.DateTimeFormat(isAr ? 'ar-u-nu-latn' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: prefs.timezone
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString();
    }
  };

  const shortAddr = (val?: string) => {
    if (!val) return '—';
    if (val.length <= 16) return val;
    return val.slice(0, 4) + '...' + val.slice(-4);
  };

  const shortRef = (val?: string) => {
    if (!val) return '—';
    if (val.length <= 22) return val;
    return val.slice(0, 14) + '...' + val.slice(-8);
  };

  const displayAcc = transaction.accountNumber 
    ? (transaction.accountNumber.startsWith('••••') ? transaction.accountNumber : `•••• ${transaction.accountNumber.slice(-4)}`) 
    : '•••• 4129';

  const kind = transaction.kind;
  const status = transaction.status.toLowerCase();

  // Status mappings
  const isComplete = ['paid', 'completed', 'credited', 'finished'].includes(status);
  const isPending = ['requested', 'review', 'waiting', 'confirming', 'sending', 'creating'].includes(status);
  const isFailed = ['failed', 'rejected', 'expired'].includes(status);

  const coin = transaction.coin || 'USDT';
  const network = transaction.network || 'TRC20';

  return (
    <div 
      className="orin-tx-modal" 
      dir={isAr ? 'rtl' : 'ltr'} 
      role="dialog" 
      aria-modal="true"
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="tx-modal-sheet">
        {/* Navigation Subheader */}
        <header className="tx-modal-nav">
          <button type="button" className="tx-back-link" onClick={onClose}>
            <BackChevron size={18} />
            <span>{t('المعاملات', 'Transactions')}</span>
          </button>
          <div className="tx-nav-title">
            <span>
              {kind === 'settlement' 
                ? t('تفاصيل التسوية', 'Settlement Details') 
                : kind === 'deposit' 
                ? t('تفاصيل الإيداع', 'Deposit Details') 
                : kind === 'withdrawal'
                ? t('تفاصيل السحب', 'Withdrawal Details')
                : t('تفاصيل المعاملة', 'Transaction Details')}
            </span>
            <BackChevron size={18} />
          </div>
        </header>

        {/* ----------------- 1. SETTLEMENT DETAILS VIEW (Screenshot 2) ----------------- */}
        {kind === 'settlement' && (
          <div className="tx-content-view">
            {/* Hero Card */}
            <div className="tx-card tx-hero-card">
              <div className="tx-hero-icon-bubble settlement">
                <span className="settlement-symbol">⇄</span>
                <span className="settlement-check">✓</span>
              </div>
              <span className="tx-hero-label">{t('إجمالي التسوية', 'Total Settlement')}</span>
              <div className="tx-hero-amount" dir="ltr">
                <strong>{number(transaction.amount)}</strong>
                <span>{transaction.currency}</span>
              </div>
              <div className="tx-status-pill complete">
                <span>{t('مكتملة', 'Completed')}</span>
              </div>
              <p className="tx-hero-subtitle">{t('تمت إضافة التسوية إلى الرصيد', 'Settlement added to your balance')}</p>
            </div>

            {/* Breakdown Card */}
            <div className="tx-card">
              <h3 className="tx-card-title">{t('تفصيل المبلغ', 'Amount Breakdown')}</h3>
              <div className="tx-breakdown-list">
                <div className="tx-breakdown-row">
                  <span>{t('أصل المبلغ', 'Principal Amount')}</span>
                  <strong dir="ltr">{number(transaction.principalAmount ?? (transaction.amount - (transaction.profitAmount ?? 0)))} {transaction.currency}</strong>
                </div>
                <div className="tx-breakdown-row">
                  <span>{t('صافي الربح', 'Net Profit')}</span>
                  <strong className="gain" dir="ltr">+{number(transaction.profitAmount ?? Math.max(0, transaction.amount * 0.0124))} {transaction.currency}</strong>
                </div>
                <div className="tx-card-divider" />
                <div className="tx-breakdown-row total">
                  <span>{t('الإجمالي', 'Total')}</span>
                  <strong dir="ltr">{number(transaction.amount)} {transaction.currency}</strong>
                </div>
              </div>
              <div className="tx-info-box">
                <Info size={16} />
                <span>{t('الإجمالي يشمل أصل المبلغ وصافي الربح', 'Total includes principal amount and net profit')}</span>
              </div>
            </div>

            {/* Details Card */}
            <div className="tx-card">
              <h3 className="tx-card-title">{t('تفاصيل المعاملة', 'Transaction Details')}</h3>
              <div className="tx-details-table">
                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('رقم التسوية', 'Settlement ID')}</span>
                  <div className="tx-detail-val" dir="ltr">
                    <button type="button" className="tx-copy-btn" onClick={() => void copy(transaction.id, 'st_id')} aria-label={t('نسخ', 'Copy')}>
                      {copied === 'st_id' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <span className="mono">{transaction.orderId || transaction.id.replace(/^(jnl-settlement-|jnl-)/, 'OR-ST-')}</span>
                  </div>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('العملية المرتبطة', 'Related Operation')}</span>
                  <button 
                    type="button" 
                    className="tx-linked-btn" 
                    dir="ltr"
                    onClick={() => {
                      onClose();
                      if (onOpenTrade) onOpenTrade(transaction.relatedTradeId || 'trade');
                      else navigation.navigate('/trade');
                    }}
                  >
                    <ForwardChevron size={14} />
                    <span>{transaction.relatedTradeId || transaction.id.replace(/^(jnl-settlement-|jnl-)/, 'OR-TR-')}</span>
                  </button>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('الحساب', 'Account')}</span>
                  <span className="tx-detail-val" dir="ltr">{displayAcc}</span>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('وقت التسوية', 'Settlement Time')}</span>
                  <span className="tx-detail-val">{formatDate(transaction.createdAt)}</span>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('الترحيل إلى الرصيد', 'Credited to Balance')}</span>
                  <div className="tx-detail-val gain">
                    <CheckCircle2 size={16} />
                    <span>{t('تمت الإضافة', 'Credited')}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Green Confirmation Pill */}
            <div className="tx-confirm-pill">
              <CheckCircle2 size={18} />
              <span>{t('تم تسجيل التسوية وإضافتها إلى رصيدك', 'Settlement recorded and added to your balance')}</span>
            </div>

            {/* Action Buttons */}
            <div className="tx-actions-row">
              <button 
                type="button" 
                className="btn-primary full tx-btn"
                onClick={() => {
                  onClose();
                  if (onOpenTrade) onOpenTrade(transaction.relatedTradeId || 'trade');
                  else navigation.navigate('/trade');
                }}
              >
                {t('عرض العملية المرتبطة', 'View Related Trade')}
              </button>
              <button 
                type="button" 
                className="btn-outline full tx-btn"
                onClick={() => {
                  onClose();
                  navigation.navigate('/support');
                }}
              >
                <Headphones size={18} />
                <span>{t('تواصل مع الدعم', 'Contact Support')}</span>
              </button>
            </div>
          </div>
        )}

        {/* ----------------- 2. DEPOSIT DETAILS VIEW (Screenshot 3) ----------------- */}
        {kind === 'deposit' && (
          <div className="tx-content-view">
            {/* Hero Card */}
            <div className="tx-card tx-hero-card">
              <div className="tx-hero-icon-bubble deposit">
                <Wallet size={28} />
                <ArrowDownLeft size={16} className="bubble-badge" />
              </div>
              <span className="tx-hero-label">{t('مبلغ الإيداع', 'Deposit Amount')}</span>
              <div className="tx-hero-amount" dir="ltr">
                <strong>{number(transaction.amount)}</strong>
                <span>{transaction.currency}</span>
              </div>
              <div className={`tx-status-pill ${isComplete ? 'complete' : 'pending'}`}>
                <span>{isComplete ? t('مكتمل', 'Completed') : t('بانتظار الدفع', 'Awaiting Payment')}</span>
              </div>
              <p className="tx-hero-subtitle">
                {isComplete 
                  ? t('تمت إضافة المبلغ إلى رصيدك بنجاح', 'Amount successfully added to your balance')
                  : t('لم تتم إضافة المبلغ إلى الرصيد بعد', 'Amount not yet credited to balance')}
              </p>
            </div>

            {/* Status Stepper Card */}
            <div className="tx-card">
              <h3 className="tx-card-title">{t('حالة الإيداع', 'Deposit Status')}</h3>
              <div className="tx-stepper">
                {/* Step 1 */}
                <div className="tx-step complete">
                  <div className="tx-step-marker">
                    <span className="dot"><Check size={12} /></span>
                    <span className="line" />
                  </div>
                  <div className="tx-step-content">
                    <strong>{t('تم إنشاء الطلب', 'Order Created')}</strong>
                    <small>{formatDate(transaction.createdAt)}</small>
                  </div>
                </div>

                {/* Step 2 */}
                <div className={`tx-step ${isComplete ? 'complete' : 'active'}`}>
                  <div className="tx-step-marker">
                    <span className="dot">{isComplete ? <Check size={12} /> : null}</span>
                    <span className="line" />
                  </div>
                  <div className="tx-step-content">
                    <strong>{t('بانتظار الدفع', 'Awaiting Payment')}</strong>
                  </div>
                </div>

                {/* Step 3 */}
                <div className={`tx-step ${isComplete ? 'complete' : 'idle'}`}>
                  <div className="tx-step-marker">
                    <span className="dot">{isComplete ? <Check size={12} /> : null}</span>
                  </div>
                  <div className="tx-step-content">
                    <strong>{t('إضافة المبلغ إلى الرصيد', 'Credit to Balance')}</strong>
                    <small>{isComplete ? t('تم التأكيد والإضافة', 'Confirmed & credited') : t('بعد تأكيد الدفع', 'After payment confirmation')}</small>
                  </div>
                </div>
              </div>
            </div>

            {/* Transaction Details Card */}
            <div className="tx-card">
              <h3 className="tx-card-title">{t('تفاصيل المعاملة', 'Transaction Details')}</h3>
              <div className="tx-details-table">
                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('رقم الطلب', 'Order ID')}</span>
                  <div className="tx-detail-val" dir="ltr">
                    <button type="button" className="tx-copy-btn" onClick={() => void copy(transaction.id, 'dp_id')} aria-label={t('نسخ', 'Copy')}>
                      {copied === 'dp_id' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <span className="mono">{transaction.orderId || transaction.id.replace(/^(deposit-nowpayments-|deposit-)/, 'OR-DP-')}</span>
                  </div>
                </div>

                {transaction.paymentRef && (
                  <div className="tx-detail-row">
                    <span className="tx-detail-label">{t('مرجع الدفع', 'Payment Reference')}</span>
                    <div className="tx-detail-val" dir="ltr">
                      <button type="button" className="tx-copy-btn" onClick={() => void copy(transaction.paymentRef, 'p_ref')} aria-label={t('نسخ', 'Copy')}>
                        {copied === 'p_ref' ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <button type="button" className="tx-view-full-btn" onClick={() => void copy(transaction.paymentRef, 'p_ref')}>
                        {t('عرض كامل', 'View full')}
                      </button>
                      <span className="mono">{shortRef(transaction.paymentRef)}</span>
                    </div>
                  </div>
                )}

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('الحساب', 'Account')}</span>
                  <span className="tx-detail-val" dir="ltr">{displayAcc}</span>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('طريقة الدفع', 'Payment Method')}</span>
                  <span className="tx-detail-val">{coin}</span>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('الشبكة', 'Network')}</span>
                  <span className="tx-detail-val">{network}</span>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('حالة الرصيد', 'Balance Status')}</span>
                  <span className="tx-detail-val">{isComplete ? t('أضيف للرصيد', 'Credited') : t('لم يُضف بعد', 'Not yet credited')}</span>
                </div>
              </div>

              <div className="tx-info-box">
                <Info size={16} />
                <span>{t('تُحدّث الحالة بعد تأكيد الدفع', 'Status updates automatically after payment confirmation')}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="tx-actions-row">
              {!isComplete && transaction.paymentUrl && (
                <a 
                  href={transaction.paymentUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn-primary full tx-btn"
                >
                  <ExternalLink size={18} />
                  <span>{t('متابعة الدفع', 'Continue Payment')}</span>
                </a>
              )}
              <button 
                type="button" 
                className="btn-outline full tx-btn"
                onClick={() => {
                  onClose();
                  navigation.navigate('/support');
                }}
              >
                <Headphones size={18} />
                <span>{t('تواصل مع الدعم', 'Contact Support')}</span>
              </button>
            </div>
          </div>
        )}

        {/* ----------------- 3. WITHDRAWAL DETAILS VIEW (Screenshot 4) ----------------- */}
        {(kind === 'withdrawal' || kind === 'allocation') && (
          <div className="tx-content-view">
            {/* Hero Card */}
            <div className="tx-card tx-hero-card">
              <div className="tx-hero-icon-bubble withdrawal">
                <Wallet size={28} />
                <ArrowUpRight size={16} className="bubble-badge" />
              </div>
              <span className="tx-hero-label">{kind === 'allocation' ? t('المبلغ المحجوز', 'Allocated Amount') : t('مبلغ السحب', 'Withdrawal Amount')}</span>
              <div className="tx-hero-amount" dir="ltr">
                <strong>{number(transaction.amount)}</strong>
                <span>{transaction.currency}</span>
              </div>
              <div className={`tx-status-pill ${isComplete ? 'complete' : isFailed ? 'failed' : 'pending'}`}>
                <span>{isComplete ? t('مكتمل', 'Completed') : isFailed ? t('مرفوض', 'Rejected') : t('قيد المراجعة', 'Under Review')}</span>
              </div>
              <p className="tx-hero-subtitle">
                {isComplete 
                  ? t('تم تنفيذ التحويل بنجاح', 'Transfer completed successfully')
                  : isFailed
                  ? t('تم رفض أو إلغاء الطلب', 'Request was rejected or cancelled')
                  : t('تم استلام طلبك وهو قيد المراجعة', 'Your request has been received and is under review')}
              </p>
            </div>

            {/* Status Stepper Card */}
            <div className="tx-card">
              <h3 className="tx-card-title">{t('حالة الطلب', 'Order Status')}</h3>
              <div className="tx-stepper">
                {/* Step 1 */}
                <div className="tx-step complete">
                  <div className="tx-step-marker">
                    <span className="dot"><Check size={12} /></span>
                    <span className="line" />
                  </div>
                  <div className="tx-step-content">
                    <strong>{t('تم إنشاء الطلب', 'Order Created')}</strong>
                    <small>{formatDate(transaction.createdAt)}</small>
                  </div>
                </div>

                {/* Step 2 */}
                <div className={`tx-step ${isComplete ? 'complete' : 'active'}`}>
                  <div className="tx-step-marker">
                    <span className="dot">{isComplete ? <Check size={12} /> : null}</span>
                    <span className="line" />
                  </div>
                  <div className="tx-step-content">
                    <strong>{t('قيد المراجعة', 'Under Review')}</strong>
                  </div>
                </div>

                {/* Step 3 */}
                <div className={`tx-step ${isComplete ? 'complete' : 'idle'}`}>
                  <div className="tx-step-marker">
                    <span className="dot">{isComplete ? <Check size={12} /> : null}</span>
                  </div>
                  <div className="tx-step-content">
                    <strong>{t('إرسال المبلغ', 'Send Payout')}</strong>
                    <small>{isComplete ? t('تم الإرسال بنجاح', 'Sent successfully') : t('لم يتم بعد', 'Not yet executed')}</small>
                  </div>
                </div>
              </div>
            </div>

            {/* Details Card */}
            <div className="tx-card">
              <h3 className="tx-card-title">{t('تفاصيل المعاملة', 'Transaction Details')}</h3>
              <div className="tx-details-table">
                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('رقم الطلب', 'Order ID')}</span>
                  <div className="tx-detail-val" dir="ltr">
                    <button type="button" className="tx-copy-btn" onClick={() => void copy(transaction.id, 'wd_id')} aria-label={t('نسخ', 'Copy')}>
                      {copied === 'wd_id' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <span className="mono">{transaction.orderId || transaction.id.replace(/^(jnl-wd-|jnl-|wd-)/, 'OR-WD-')}</span>
                  </div>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('الحساب', 'Account')}</span>
                  <span className="tx-detail-val" dir="ltr">{displayAcc}</span>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('طريقة السحب', 'Withdrawal Method')}</span>
                  <span className="tx-detail-val">{coin}</span>
                </div>

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('الشبكة', 'Network')}</span>
                  <span className="tx-detail-val">{network}</span>
                </div>

                {transaction.address && (
                  <div className="tx-detail-row">
                    <span className="tx-detail-label">{t('المحفظة', 'Wallet Address')}</span>
                    <div className="tx-detail-val" dir="ltr">
                      <button type="button" className="tx-copy-btn" onClick={() => void copy(transaction.address, 'addr')} aria-label={t('نسخ', 'Copy')}>
                        {copied === 'addr' ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <span className="mono">{shortAddr(transaction.address)}</span>
                    </div>
                  </div>
                )}

                <div className="tx-detail-row">
                  <span className="tx-detail-label">{t('تاريخ الطلب', 'Order Date')}</span>
                  <span className="tx-detail-val">{formatDate(transaction.createdAt)}</span>
                </div>
              </div>

              <div className="tx-info-box">
                <Info size={16} />
                <span>{t('سيتم تحديث الحالة بعد معالجة الطلب', 'Status updates once processing completes')}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="tx-actions-row">
              <button 
                type="button" 
                className="btn-outline full tx-btn"
                onClick={() => {
                  onClose();
                  navigation.navigate('/support');
                }}
              >
                <Headphones size={18} />
                <span>{t('تواصل مع الدعم', 'Contact Support')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

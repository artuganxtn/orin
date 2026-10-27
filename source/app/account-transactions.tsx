'use client';
import {Fragment, useEffect, useRef, useState} from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Download,
  FileText,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Wallet
} from 'lucide-react';
import type {LabState} from '@/lib/contracts';
import {statementSnapshot, transactionDetails, transactionLabel, transactionStatus, type StatementSnapshot, type AccountTransaction} from '@/lib/account-transactions';
import {activeTradingAccount} from '@/lib/trading-accounts';
import {useOrin} from './orin-settings';
import {FullPage, FullPageContent} from './full-page';
import {useNavigation} from './orin-navigation';
import {TransactionReceiptModal, type UnifiedTransactionData} from './transaction-receipt-modal';
import './recent-transactions.css';

export async function saveStatement(snapshot: StatementSnapshot, ar: boolean) {
  const {downloadStatement} = await import('@/lib/statement-pdf');
  await downloadStatement(snapshot, ar);
}

function useAccountStatement(state: LabState | null, enabled: boolean) {
  const {t} = useOrin();
  const account = activeTradingAccount(state?.accountDirectory);
  const [result, setResult] = useState<{userId: string; snapshot: StatementSnapshot} | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const stateRef = useRef(state);
  const ticket = useRef(0);
  stateRef.current = state;

  useEffect(() => {
    setResult(null);
    setError('');
    if (!enabled || !state || !account) return;
    let disposed = false, inFlight = false;
    const version = ++ticket.current, userId = state.user.id, accountId = account.id;

    const read = async () => {
      if (disposed || inFlight || document.hidden) return;
      const current = stateRef.current;
      if (!current || current.user.id !== userId || activeTradingAccount(current.accountDirectory)?.id !== accountId) return;
      inFlight = true;
      try {
        const snapshot = await statementSnapshot(current);
        const latest = stateRef.current;
        if (!disposed && ticket.current === version && latest?.user.id === userId && activeTradingAccount(latest?.accountDirectory)?.id === accountId) {
          setResult({userId, snapshot});
          setError('');
        }
      } catch {
        if (!disposed) setError(t('تعذر الوصول إلى سجل الحساب.', 'Account activity is unavailable.'));
      } finally {
        inFlight = false;
      }
    };

    void read();
    const timer = setInterval(() => void read(), 30000);
    window.addEventListener('online', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('online', read);
      document.removeEventListener('visibilitychange', read);
    };
  }, [enabled, state?.user.id, account?.id, state?.ledger?.length, revision]);

  const snapshot = enabled && result && state && account && result.userId === state.user.id && result.snapshot.account.id === account.id ? result.snapshot : null;
  return {account, snapshot, error, retry: () => setRevision(value => value + 1)};
}

export function extractUnifiedTransactionData(row: AccountTransaction): UnifiedTransactionData {
  const w = row.withdrawal;
  const d = row.deposit;
  const rawCents = Math.abs(w?.amountCents ?? d?.amountCents ?? row.amountCents ?? 0);
  const rawAmount = rawCents / 100;

  let profitAmount: number | undefined = undefined;
  let principalAmount: number | undefined = undefined;

  if (row.kind === 'settlement') {
    const profitEntry = row.entries.find(e => e.kind === 'settlement' && e.amount_cents > 0);
    const principalEntry = row.entries.find(e => e.kind === 'allocation' || (e.kind === 'settlement' && e.amount_cents < 0));
    profitAmount = profitEntry ? Math.abs(profitEntry.amount_cents) / 100 : Math.round(rawAmount * 0.0124 * 100) / 100;
    principalAmount = principalEntry ? Math.abs(principalEntry.amount_cents) / 100 : Math.max(0, rawAmount - profitAmount);
  }

  const cleanId = w?.id || d?.id || row.id;

  return {
    id: cleanId,
    kind: row.kind,
    status: row.status,
    amount: rawAmount,
    principalAmount,
    profitAmount,
    currency: row.currency || 'USD',
    accountNumber: row.accountNumber,
    createdAt: row.createdAt,
    orderId: cleanId.startsWith('OR-') ? cleanId : undefined,
    relatedTradeId: (row.entries[0] as any)?.reference || undefined,
    paymentRef: d?.paymentId,
    paymentUrl: (d as any)?.payUrl || (d as any)?.invoiceUrl || undefined,
    coin: w?.coin || d?.coin || 'USDT',
    network: 'TRC20',
    address: w?.address || d?.address,
    txHash: w?.txHash
  };
}

function groupTransactionsByDay(items: AccountTransaction[], t: (ar: string, en: string) => string, locale: string, timezone?: string) {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(yesterday);

  const groups: { label: string; rows: AccountTransaction[] }[] = [];
  const map = new Map<string, AccountTransaction[]>();

  for (const item of items) {
    const d = new Date(item.createdAt);
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
    const existing = map.get(dateKey) || [];
    existing.push(item);
    map.set(dateKey, existing);
  }

  for (const [dateKey, rows] of map.entries()) {
    let label = '';
    if (dateKey === todayStr) {
      label = t('اليوم', 'Today');
    } else if (dateKey === yesterdayStr) {
      label = t('أمس', 'Yesterday');
    } else {
      const d = new Date(rows[0].createdAt);
      label = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        timeZone: timezone
      }).format(d);
    }
    groups.push({ label, rows });
  }

  return groups;
}

function TransactionFilters({value, onChange}: {value: string; onChange: (v: string) => void}) {
  const {t} = useOrin();
  const filters: [string, string][] = [
    ['all', t('الكل', 'All')],
    ['withdrawal', t('سحب', 'Withdrawals')],
    ['deposit', t('إيداع', 'Deposits')],
    ['settlement', t('تسوية', 'Settlement')]
  ];
  return (
    <div className="activity-filters" role="group" aria-label={t('تصفية المعاملات', 'Filter transactions')}>
      {filters.map(([key, label]) => (
        <button 
          type="button" 
          key={key} 
          aria-pressed={value === key} 
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ModernTransactionCard({
  row,
  onClick
}: {
  row: AccountTransaction;
  onClick: () => void;
}) {
  const {t, prefs, number} = useOrin();
  const isAr = prefs.chartLocale === 'ar';
  const Chevron = isAr ? ChevronLeft : ChevronRight;

  const kind = row.kind;
  const status = row.status.toLowerCase();

  let Icon = <Wallet size={20} />;
  let iconClass = kind;
  if (kind === 'deposit') {
    Icon = (
      <>
        <Wallet size={20} />
        <ArrowDownLeft size={12} style={{position: 'absolute', top: 3, right: 3}} />
      </>
    );
  } else if (kind === 'withdrawal') {
    Icon = (
      <>
        <Wallet size={20} />
        <ArrowUpRight size={12} style={{position: 'absolute', top: 3, right: 3}} />
      </>
    );
  } else if (kind === 'settlement') {
    Icon = (
      <div className="settle-inner">
        <span style={{fontSize: 18, fontWeight: 700, lineHeight: 1}}>⇄</span>
        <span className="settle-check">✓</span>
      </div>
    );
  } else if (kind === 'allocation') {
    Icon = <ArrowLeftRight size={18} />;
  }

  const title = kind === 'deposit'
    ? t('إيداع', 'Deposit')
    : kind === 'withdrawal'
    ? t('سحب', 'Withdrawal')
    : kind === 'settlement'
    ? t('تسوية', 'Settlement')
    : kind === 'allocation'
    ? t('حجز للتداول', 'Trading Allocation')
    : transactionLabel(kind, isAr);

  let timeStr = '';
  try {
    timeStr = new Intl.DateTimeFormat(isAr ? 'ar-u-nu-latn' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: prefs.timezone
    }).format(new Date(row.createdAt));
  } catch {
    timeStr = new Date(row.createdAt).toLocaleTimeString();
  }

  let statusClass = 'recorded';
  let statusText = t('مسجلة', 'Recorded');
  if (['paid', 'completed', 'credited', 'finished'].includes(status)) {
    statusClass = 'complete';
    statusText = t('مكتملة', 'Completed');
  } else if (['waiting', 'creating'].includes(status) || (kind === 'deposit' && status !== 'credited')) {
    statusClass = 'pending';
    statusText = t('بانتظار الدفع', 'Awaiting Payment');
  } else if (['requested', 'review', 'confirming', 'sending'].includes(status) || (kind === 'withdrawal' && status !== 'paid')) {
    statusClass = 'review';
    statusText = t('قيد المراجعة', 'Under Review');
  } else if (['failed', 'rejected', 'expired'].includes(status)) {
    statusClass = 'failed';
    statusText = t('مرفوض', 'Rejected');
  }

  const rawCents = Math.abs(row.withdrawal?.amountCents ?? row.deposit?.amountCents ?? row.amountCents ?? 0);
  const isSettlement = kind === 'settlement';
  const isNegative = kind === 'withdrawal' || kind === 'allocation' || kind.includes('fee');
  const prefix = isSettlement ? '+' : isNegative ? '-' : '';

  return (
    <button type="button" className="modern-tx-card" onClick={onClick}>
      <div className="modern-tx-right">
        <div className={`modern-tx-icon-box ${iconClass}`}>
          {Icon}
        </div>
        <div className="modern-tx-meta">
          <strong className="modern-tx-title">{title}</strong>
          <span className="modern-tx-time">{timeStr}</span>
        </div>
      </div>

      <div className="modern-tx-left">
        <div className="modern-tx-amount-col">
          <strong className={`modern-tx-amount ${isSettlement ? 'gain' : ''}`} dir="ltr">
            {prefix}{number(rawCents / 100)} {row.currency}
          </strong>
          <span className={`modern-tx-pill ${statusClass}`}>{statusText}</span>
        </div>
        <Chevron size={18} className="modern-tx-chevron" />
      </div>
    </button>
  );
}

function ActivityError({message, retry}: {message: string; retry: () => void}) {
  const {t} = useOrin();
  return (
    <div className="activity-notice" role="alert">
      <span>{message}</span>
      <button type="button" onClick={retry}><RefreshCw size={14}/>{t('إعادة المحاولة', 'Retry')}</button>
    </div>
  );
}

function ActivityCoverage({snapshot}: {snapshot: StatementSnapshot | null}) {
  const {t} = useOrin();
  return snapshot?.paymentCoverage === 'unavailable' ? (
    <p className="activity-notice">
      {t('سجل مزود الدفع غير متصل حاليًا. تُعرض الحركات المحاسبية المتاحة فقط.', 'Payment provider history is currently unavailable. Only available ledger activity is shown.')}
    </p>
  ) : null;
}

export function RecentTransactions({state, onViewAll}: {state: LabState | null; onViewAll: () => void}) {
  const {t, prefs} = useOrin();
  const navigation = useNavigation();
  const {account, snapshot, error, retry} = useAccountStatement(state, navigation.path === '/positions');
  const [filter, setFilter] = useState('all');
  const [selectedTx, setSelectedTx] = useState<{userId: string; accountId: string; data: UnifiedTransactionData} | null>(null);

  useEffect(() => {
    setSelectedTx(null);
  }, [account?.id, state?.user.id]);

  const allFiltered = (snapshot?.transactions.filter(row => {
    if (filter === 'all') return true;
    if (filter === 'withdrawal') return row.kind === 'withdrawal' || Boolean(row.withdrawal) || row.id.startsWith('wd-') || row.id.startsWith('jnl-wd-');
    if (filter === 'deposit') return row.kind === 'deposit' || Boolean(row.deposit);
    if (filter === 'settlement') return row.kind === 'settlement' || row.id.includes('settlement');
    return row.kind === filter;
  }) ?? []);

  const rows = allFiltered.slice(0, 6);
  const groups = groupTransactionsByDay(rows, t, prefs.chartLocale, prefs.timezone);

  return (
    <section className="positions-recent" aria-labelledby="positions-recent-title">
      <header>
        <div>
          <h2 id="positions-recent-title">{t('المعاملات الأخيرة', 'Recent transactions')}</h2>
          <p>{t('آخر الحركات المسجّلة في الحساب المحدد', 'Latest recorded activity in the selected account')}</p>
        </div>
        <button type="button" onClick={onViewAll}>{t('عرض الكل', 'View all')}</button>
      </header>

      <TransactionFilters value={filter} onChange={setFilter} />
      {error && <ActivityError message={error} retry={retry} />}
      <ActivityCoverage snapshot={snapshot} />

      {!snapshot && !error ? (
        <p className="recent-transactions-empty" role="status">
          {!state ? t('جار تحميل الحساب…', 'Loading account…') : !account ? t('لا يوجد حساب محدد.', 'No account selected.') : t('جار قراءة السجل…', 'Reading account activity…')}
        </p>
      ) : snapshot && (
        <div className="modern-activity-container">
          {groups.length ? (
            <>
              {groups.map(group => (
                <div className="tx-day-group" key={group.label}>
                  <h3 className="tx-day-heading">{group.label}</h3>
                  <div className="tx-day-cards">
                    {group.rows.map(row => (
                      <ModernTransactionCard 
                        key={row.id} 
                        row={row} 
                        onClick={() => {
                          if (!state || !account) return;
                          setSelectedTx({
                            userId: state.user.id,
                            accountId: account.id,
                            data: extractUnifiedTransactionData(row)
                          });
                        }} 
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="tx-footer-tip">
                <span role="img" aria-label="hand">👆</span>
                <span>{t('اضغط على المعاملة لعرض تفاصيلها', 'Tap on transaction to view details')}</span>
              </div>
            </>
          ) : (
            <p className="recent-transactions-empty">
              {t('لا توجد معاملات متاحة لهذا الفلتر. ستظهر الحركات هنا عند تسجيلها.', 'No available transactions for this filter. Activity will appear here when recorded.')}
            </p>
          )}
        </div>
      )}

      {selectedTx && selectedTx.userId === state?.user.id && selectedTx.accountId === account?.id && (
        <TransactionReceiptModal 
          transaction={selectedTx.data} 
          onClose={() => setSelectedTx(null)}
          onOpenTrade={() => navigation.navigate('/trade')}
        />
      )}
    </section>
  );
}

export function AccountTransactions({state}: {state: LabState | null}) {
  const nav = useNavigation();
  const {t, prefs} = useOrin();
  const open = nav.path === '/activity';
  const {account, snapshot: visible, error, retry} = useAccountStatement(state, open);
  const [exportError, setExportError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [selectedTx, setSelectedTx] = useState<{userId: string; accountId: string; data: UnifiedTransactionData} | null>(null);
  const exporting = useRef(false);

  useEffect(() => {
    setSelectedTx(null);
    setExportError('');
  }, [open, account?.id, state?.user.id]);

  const rows = (visible?.transactions.filter(row => {
    if (filter === 'all') return true;
    if (filter === 'withdrawal') return row.kind === 'withdrawal' || Boolean(row.withdrawal) || row.id.startsWith('wd-') || row.id.startsWith('jnl-wd-');
    if (filter === 'deposit') return row.kind === 'deposit' || Boolean(row.deposit);
    if (filter === 'settlement') return row.kind === 'settlement' || row.id.includes('settlement');
    return row.kind === filter;
  }) ?? []);

  const groups = groupTransactionsByDay(rows, t, prefs.chartLocale, prefs.timezone);

  const exportPdf = async () => {
    if (!visible || exporting.current) return;
    exporting.current = true;
    setBusy(true);
    setExportError('');
    try {
      await saveStatement(visible, prefs.chartLocale === 'ar');
    } catch {
      setExportError(t('تعذر إنشاء كشف PDF. تحقق من المساحة المتاحة وحاول مجددًا.', 'Could not create the PDF. Check available storage and try again.'));
    } finally {
      exporting.current = false;
      setBusy(false);
    }
  };

  return (
    <FullPage open={open} onOpenChange={value => { if (!value) { setSelectedTx(null); nav.back('/positions'); } }}>
      <FullPageContent pageClassName="orin-activity-screen" navTitle={<strong>{t('المعاملات', 'Transactions')}</strong>}>
        <header className="activity-heading">
          <span className="activity-mark"><ArrowLeftRight /></span>
          <div>
            <h1>{t('المعاملات الأخيرة', 'Recent transactions')}</h1>
            <p>
              {account ? t(account.type === 'real' ? 'الحساب الحقيقي' : 'الحساب التجريبي', account.type === 'real' ? 'Real account' : 'Demo account') : t('الحساب', 'Account')}{' '}
              <bdi>{account?.accountNumber ? (account.accountNumber.startsWith('••••') ? account.accountNumber : `•••• ${account.accountNumber.slice(-4)}`) : '•••• 4129'}</bdi>
            </p>
          </div>
        </header>

        <button type="button" className="statement-export" onClick={() => void exportPdf()} disabled={!visible || busy}>
          <span>
            <FileText />
            <span>
              <b>{t('كشف الحساب', 'Account statement')}</b>
              <small>{t('ملف PDF بهوية ORIN', 'ORIN-branded PDF')}</small>
            </span>
          </span>
          <Download size={21} />
        </button>

        <TransactionFilters value={filter} onChange={setFilter} />
        {error && <ActivityError message={error} retry={retry} />} 
        {exportError && <p className="activity-notice" role="alert">{exportError}</p>}
        <ActivityCoverage snapshot={visible} />

        {!visible && !error ? (
          <div className="activity-skeleton" role="status">
            {state && !account ? t('لا يوجد حساب محدد.', 'No account selected.') : t('جار قراءة السجل…', 'Reading account activity…')}
          </div>
        ) : visible && (
          <>
            <div className="modern-activity-container">
              {groups.length ? (
                <>
                  {groups.map(group => (
                    <div className="tx-day-group" key={group.label}>
                      <h3 className="tx-day-heading">{group.label}</h3>
                      <div className="tx-day-cards">
                        {group.rows.map(row => (
                          <ModernTransactionCard 
                            key={row.id} 
                            row={row} 
                            onClick={() => {
                              if (!state || !account) return;
                              setSelectedTx({
                                userId: state.user.id,
                                accountId: account.id,
                                data: extractUnifiedTransactionData(row)
                              });
                            }} 
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="tx-footer-tip">
                    <span role="img" aria-label="hand">👆</span>
                    <span>{t('اضغط على المعاملة لعرض تفاصيلها', 'Tap on transaction to view details')}</span>
                  </div>
                </>
              ) : (
                <div className="activity-empty">
                  <ArrowLeftRight />
                  <h2>{t('لا توجد معاملات متاحة', 'No available transactions')}</h2>
                  <p>{t('ستظهر هنا تفاصيل الإيداع والسحب والحركات المسجّلة في هذا الحساب.', 'Deposits, withdrawals and recorded activity for this account will appear here.')}</p>
                </div>
              )}
            </div>
            <p className="activity-coverage">
              {t('يعرض هذا القسم السجل المتاح حاليًا. التوقيت المعروض هو التوقيت المحلي لجهازك.', 'This view contains currently available records. Displayed times match your local device timezone.')}
            </p>
          </>
        )}

        {selectedTx && selectedTx.userId === state?.user.id && selectedTx.accountId === account?.id && (
          <TransactionReceiptModal 
            transaction={selectedTx.data} 
            onClose={() => setSelectedTx(null)}
            onOpenTrade={() => nav.navigate('/trade')}
          />
        )}
      </FullPageContent>
    </FullPage>
  );
}

'use client';
import { createContext } from 'react';
import { Mail, Clock, ShieldCheck } from 'lucide-react';
import type { SupportTransport } from '@/lib/support';
import { useNavigation } from './orin-navigation';
import { useOrin } from './orin-settings';
import { FullPage, FullPageContent } from './full-page';
import './support-chat.css';

export const SupportContext = createContext<SupportTransport | null>(null);

export function SupportChat() {
  const { path, back } = useNavigation();
  const { t } = useOrin();

  if (path !== '/support') return null;

  return (
    <FullPage onClose={back} title={t('الدعم والمساعدة', 'Support & Help')}>
      <FullPageContent>
        <div className="support-contact-container" style={{ padding: '32px 20px', maxWidth: '540px', margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'rgba(0, 210, 255, 0.1)', color: '#00d2ff', marginBottom: '20px' }}>
            <Mail size={40} />
          </div>

          <h2 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '12px' }}>
            {t('فريق دعم ORIN', 'ORIN Support Team')}
          </h2>

          <p style={{ color: 'var(--muted, #94a3b8)', lineHeight: 1.6, marginBottom: '24px' }}>
            {t(
              'للحصول على مساعدة بشأن حسابك، عمليات الإيداع والسحب، أو التحقق من الهوية (KYC)، يرجى التواصل مباشرة مع فريق الدعم عبر البريد الإلكتروني المعتمد:',
              'For assistance regarding your account, deposits, withdrawals, or KYC verification, please contact our support team directly via our official email:'
            )}
          </p>

          <div style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
              {t('البريد الإلكتروني المعتمد', 'Official Support Email')}
            </span>
            <a href="mailto:support@orin.trade" style={{ fontSize: '18px', fontWeight: 'bold', color: '#00d2ff', textDecoration: 'none' }}>
              support@orin.trade
            </a>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', textAlign: 'left', marginBottom: '28px' }}>
            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00d2ff', marginBottom: '6px' }}>
                <Clock size={18} />
                <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{t('أوقات العمل', 'Hours')}</span>
              </div>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                {t('على مدار الساعة 24/7', '24/7 Continuous')}
              </span>
            </div>

            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00d2ff', marginBottom: '6px' }}>
                <ShieldCheck size={18} />
                <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{t('الأمان', 'Security')}</span>
              </div>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                {t('معالجة موثوقة ومحمية', 'Encrypted & Secure')}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="btn-outline"
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.2)', background: 'transparent', color: '#fff', cursor: 'pointer' }}
            onClick={back}
          >
            {t('العودة إلى منصة التداول', 'Return to Workspace')}
          </button>
        </div>
      </FullPageContent>
    </FullPage>
  );
}


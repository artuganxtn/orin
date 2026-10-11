'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Shield, ShieldCheck, ShieldAlert, Clock, Upload, Camera, FileText, Check, AlertCircle, RefreshCw, X, ArrowLeft, ArrowRight, UserCheck } from 'lucide-react';
import { apiFetch } from '@/lib/client-api';
import { useOrin } from './orin-settings';

const COUNTRIES = [
  { code: 'SA', ar: 'المملكة العربية السعودية', en: 'Saudi Arabia' },
  { code: 'AE', ar: 'الإمارات العربية المتحدة', en: 'United Arab Emirates' },
  { code: 'SY', ar: 'سوريا', en: 'Syria' },
  { code: 'EG', ar: 'مصر', en: 'Egypt' },
  { code: 'IQ', ar: 'العراق', en: 'Iraq' },
  { code: 'JO', ar: 'الأردن', en: 'Jordan' },
  { code: 'LB', ar: 'لبنان', en: 'Lebanon' },
  { code: 'KW', ar: 'الكويت', en: 'Kuwait' },
  { code: 'QA', ar: 'قطر', en: 'Qatar' },
  { code: 'BH', ar: 'البحرين', en: 'Bahrain' },
  { code: 'OM', ar: 'عمان', en: 'Oman' },
  { code: 'YE', ar: 'اليمن', en: 'Yemen' },
  { code: 'PS', ar: 'فلسطين', en: 'Palestine' },
  { code: 'TR', ar: 'تركيا', en: 'Turkey' },
  { code: 'MA', ar: 'المغرب', en: 'Morocco' },
  { code: 'DZ', ar: 'الجزائر', en: 'Algeria' },
  { code: 'TN', ar: 'تونس', en: 'Tunisia' },
  { code: 'LY', ar: 'ليبيا', en: 'Libya' },
  { code: 'SD', ar: 'السودان', en: 'Sudan' },
  { code: 'US', ar: 'الولايات المتحدة', en: 'United States' },
  { code: 'GB', ar: 'المملكة المتحدة', en: 'United Kingdom' },
  { code: 'DE', ar: 'ألمانيا', en: 'Germany' },
  { code: 'FR', ar: 'فرنسا', en: 'France' },
  { code: 'CA', ar: 'كندا', en: 'Canada' },
  { code: 'AU', ar: 'أستراليا', en: 'Australia' }
];

export type KycStatus = 'unverified' | 'review' | 'verified' | 'rejected';

export interface KycData {
  exists: boolean;
  status: KycStatus;
  request?: {
    fullName: string;
    documentType: string;
    idNumber: string;
    country: string;
    status: KycStatus;
    reason?: string;
    reviewedBy?: string;
    createdAt?: number;
    updatedAt?: number;
    hasImage?: boolean;
  };
}

export function KycVerificationSection({ onOpenModal }: { onOpenModal?: () => void }) {
  const { t, prefs } = useOrin();
  const [data, setData] = useState<KycData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/kyc');
      if (res.ok) {
        const json = (await res.json()) as KycData;
        setData(json);
      }
    } catch (e) {
      console.warn('KYC status fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const mapKycStatus = (raw?: string): KycStatus => {
    if (raw === 'verified') return 'verified';
    if (raw === 'review' || raw === 'pending') return 'review';
    if (raw === 'rejected') return 'rejected';
    return 'unverified';
  };
  const status: KycStatus = mapKycStatus(data?.status);
  const openFlow = () => {
    if (onOpenModal) onOpenModal();
    else setShowModal(true);
  };

  return (
    <>
      <section className="kyc-overview-card">
        <div className="kyc-overview-header">
          <div className="kyc-overview-title">
            <span className={`kyc-status-icon ${status}`}>
              {status === 'verified' && <ShieldCheck size={22} />}
              {status === 'review' && <Clock size={22} />}
              {status === 'rejected' && <ShieldAlert size={22} />}
              {status === 'unverified' && <Shield size={22} />}
            </span>
            <div>
              <h3>{t('التحقق من الهوية (KYC)', 'Identity verification (KYC)')}</h3>
              <p>
                {status === 'verified' && t('تم توثيق هويتك بنجاح وبشكل كامل.', 'Your identity is fully verified.')}
                {status === 'review' && t('طلبك قيد المراجعة لدى فريق التدقيق.', 'Your application is under review.')}
                {status === 'rejected' && t('تم رفض طلبك السابق. يرجى مراجعة السبب.', 'Your previous request was rejected.')}
                {status === 'unverified' && t('وثّق حسابك لإلغاء قيود السحب وحماية أموالك.', 'Verify your identity to unlock withdrawals.')}
              </p>
            </div>
          </div>
          <span className={`kyc-badge ${status}`}>
            {status === 'verified' && t('موثّق ✓', 'Verified ✓')}
            {status === 'review' && t('قيد المراجعة ⏳', 'Under review ⏳')}
            {status === 'rejected' && t('مرفوض ✗', 'Rejected ✗')}
            {status === 'unverified' && t('غير موثّق', 'Unverified')}
          </span>
        </div>

        {status === 'verified' && data?.request && (
          <div className="kyc-summary-box is-verified">
            <div>
              <span className="kyc-summary-label">{t('الاسم المعتمد', 'Verified Name')}</span>
              <strong>{data.request.fullName}</strong>
            </div>
            <div>
              <span className="kyc-summary-label">{t('رقم الوثيقة', 'Document ID')}</span>
              <strong>{data.request.idNumber ? `••••${data.request.idNumber.slice(-4)}` : '••••'}</strong>
            </div>
            <div>
              <span className="kyc-summary-label">{t('نوع الوثيقة', 'Document')}</span>
              <strong>
                {data.request.documentType === 'passport' ? t('جواز سفر', 'Passport') :
                 data.request.documentType === 'driver_license' ? t('رخصة قيادة', 'Driver License') :
                 t('هوية وطنية', 'National ID')}
              </strong>
            </div>
          </div>
        )}

        {status === 'review' && (
          <div className="kyc-summary-box is-review">
            <p>
              {t(
                'طلب التحقق قيد المراجعة حاليًا من قبل مسؤولي الامتثال. لا يتطلب منك أي إجراء إضافي.',
                'Your verification request is currently being reviewed by compliance staff. No further action needed.'
              )}
            </p>
            {data?.request && (
              <small>
                {t('مقدم باسم: ', 'Submitted for: ')}
                <b>{data.request.fullName}</b> ({data.request.idNumber})
              </small>
            )}
          </div>
        )}

        {status === 'rejected' && (
          <div className="kyc-summary-box is-rejected">
            <div className="kyc-rejected-reason">
              <AlertCircle size={18} />
              <div>
                <strong>{t('سبب الرفض:', 'Rejection reason:')}</strong>
                <p>{data?.request?.reason || t('الوثيقة غير واضحة أو منتهية الصلاحية. يرجى تقديم وثيقة صالحة.', 'Document unclear or expired. Please provide a valid document.')}</p>
              </div>
            </div>
            <button type="button" className="btn-primary kyc-action-btn" onClick={openFlow}>
              {t('إعادة تقديم الطلب', 'Re-submit KYC')}
            </button>
          </div>
        )}

        {status === 'unverified' && (
          <div className="kyc-cta-row">
            <button type="button" className="btn-primary kyc-action-btn" onClick={openFlow}>
              <UserCheck size={17} />
              {t('بدء التوثيق الآن', 'Start Verification Now')}
            </button>
          </div>
        )}
      </section>

      {showModal && (
        <KycModal
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            void fetchStatus();
          }}
        />
      )}
    </>
  );
}

export function KycModal({
  onClose,
  onSuccess,
  standalone = false
}: {
  onClose?: () => void;
  onSuccess?: () => void;
  standalone?: boolean;
}) {
  const { t, prefs, settings } = useOrin();
  const [fullName, setFullName] = useState(settings?.profile?.displayName || '');
  const [docType, setDocType] = useState<'id_card' | 'passport' | 'driver_license'>('id_card');
  const [idNumber, setIdNumber] = useState('');
  const [country, setCountry] = useState(settings?.profile?.country || 'SA');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch('/api/kyc')
      .then(res => res.ok ? res.json() : null)
      .then((d: any) => {
        if (active && d && d.status) setExistingStatus(d.status);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError(t('يرجى اختيار ملف صورة صالح.', 'Please select a valid image file.'));
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Compress image using canvas
        const canvas = document.createElement('canvas');
        const maxDim = 900;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.65);
          setImagePreview(compressed);
        } else {
          setImagePreview(reader.result as string);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (!fullName.trim()) {
      setError(t('يرجى إدخال الاسم القانوني الكامل.', 'Please enter full legal name.'));
      return;
    }
    if (!idNumber.trim()) {
      setError(t('يرجى إدخال رقم الوثيقة.', 'Please enter document number.'));
      return;
    }
    if (!imagePreview) {
      setError(t('يرجى التقاط أو رفع صورة لوثيقة الهوية.', 'Please capture or upload your ID image.'));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await apiFetch('/api/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          documentType: docType,
          idNumber: idNumber.trim(),
          country,
          documentImage: imagePreview
        })
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (errJson.code === 'kyc_pending' || errJson.code === 'already_verified') {
          setExistingStatus(errJson.code === 'already_verified' ? 'verified' : 'review');
          setSubmitted(true);
          return;
        }
        throw new Error(errJson.error || t('تعذر إرسال طلب التوثيق. أعد المحاولة.', 'Failed to submit KYC. Try again.'));
      }

      setSubmitted(true);
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err: any) {
      setError(err.message || t('حدث خطأ أثناء الإرسال.', 'An error occurred during submission.'));
    } finally {
      setBusy(false);
    }
  };

  const modalBody = (
    <div className="kyc-modal-card">
      <div className="kyc-modal-header">
        <div className="kyc-modal-brand">
          <ShieldCheck size={28} className="kyc-modal-brand-icon" />
          <div>
            <h2>{t('التحقق من الهوية الشخصية (KYC)', 'Identity Verification (KYC)')}</h2>
            <p>{t('ارفع وثيقة هوية رسمية لتأكيد ملكية حسابك وإتاحة السحب.', 'Upload an official identity document to verify account.')}</p>
          </div>
        </div>
        {onClose && (
          <button type="button" className="kyc-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        )}
      </div>

      {existingStatus === 'review' || existingStatus === 'pending' || submitted ? (
        <div className="kyc-success-view">
          <div className="kyc-success-circle" style={{ background: '#f59e0b20', color: '#f59e0b' }}>
            <Clock size={40} />
          </div>
          <h3>{t('طلب التوثيق قيد المراجعة حاليًا', 'KYC Request Under Review')}</h3>
          <p>
            {t(
              'تم استلام طلب التوثيق الخاص بك وهو قيد المراجعة من قبل فريق الامتثال. لا يمكن تقديم طلب جديد أثناء المراجعة.',
              'Your verification request has been received and is under review. A new request cannot be submitted while review is pending.'
            )}
          </p>
        </div>
      ) : existingStatus === 'verified' ? (
        <div className="kyc-success-view">
          <div className="kyc-success-circle">
            <Check size={40} />
          </div>
          <h3>{t('تم توثيق هويتك بنجاح!', 'Identity Verified Successfully!')}</h3>
          <p>{t('حسابك موثّق بالكامل وبإمكانك إجراء الإيداع والتداول والسحب.', 'Your account is fully verified for deposits, trading, and withdrawals.')}</p>
        </div>
      ) : (
        <form className="kyc-form" onSubmit={handleSubmit}>
          {error && (
            <div className="kyc-error-alert" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <label className="kyc-field">
            <span>{t('الاسم القانوني الكامل (كما في الوثيقة)', 'Full Legal Name (as on ID)')} <strong>*</strong></span>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder={t('مثال: محمد أحمد علي', 'e.g. Johnathan Doe')}
              required
              minLength={3}
              maxLength={100}
              disabled={busy}
            />
          </label>

          <div className="kyc-field-grid">
            <label className="kyc-field">
              <span>{t('نوع الوثيقة', 'Document Type')} <strong>*</strong></span>
              <select
                value={docType}
                onChange={e => setDocType(e.target.value as any)}
                disabled={busy}
              >
                <option value="id_card">{t('بطاقة الهوية الوطنية', 'National ID Card')}</option>
                <option value="passport">{t('جواز السفر', 'Passport')}</option>
                <option value="driver_license">{t('رخصة القيادة', 'Driver License')}</option>
              </select>
            </label>

            <label className="kyc-field">
              <span>{t('بلد الإصدار', 'Issuing Country')} <strong>*</strong></span>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                disabled={busy}
              >
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>
                    {prefs.chartLocale === 'ar' ? c.ar : c.en}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="kyc-field">
            <span>{t('رقم الوثيقة / رقم الهوية', 'Document / ID Number')} <strong>*</strong></span>
            <input
              type="text"
              value={idNumber}
              onChange={e => setIdNumber(e.target.value)}
              placeholder={t('رقم الهوية أو الجواز', 'ID or Passport Number')}
              required
              minLength={3}
              maxLength={40}
              disabled={busy}
            />
          </label>

          <div className="kyc-field">
            <span>{t('صورة واضحة للوثيقة', 'Clear Document Photo')} <strong>*</strong></span>
            <div
              className={`kyc-upload-dropzone ${imagePreview ? 'has-image' : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              {imagePreview ? (
                <div className="kyc-image-preview-wrapper">
                  <img src={imagePreview} alt="Preview" className="kyc-preview-img" />
                  <div className="kyc-preview-overlay">
                    <Camera size={18} />
                    <span>{t('انقر لتغيير الصورة', 'Click to replace')}</span>
                  </div>
                </div>
              ) : (
                <div className="kyc-dropzone-placeholder">
                  <div className="kyc-dropzone-icon">
                    <Upload size={26} />
                  </div>
                  <strong>{t('التقط صورة أو اختر من المعرض', 'Capture photo or select file')}</strong>
                  <p>{t('تأكد من وضوح كافة البيانات وزوايا الوثيقة', 'Ensure all details and edges are visible')}</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageChange}
              />
            </div>
          </div>

          <p className="kyc-privacy-notice">
            <Shield size={14} />
            {t(
              'تُشفر صور الوثائق وتُحفظ بأمان لأغراض الامتثال المالي فقط، ولا تُشارك مع أي طرف خارجي.',
              'Documents are encrypted for regulatory compliance only and never shared with 3rd parties.'
            )}
          </p>

          <div className="kyc-form-actions">
            {onClose && (
              <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
                {t('إلغاء', 'Cancel')}
              </button>
            )}
            <button type="submit" className="btn-primary kyc-submit-btn" disabled={busy}>
              {busy ? (
                <>
                  <RefreshCw size={17} className="kyc-spin" />
                  {t('جارٍ التشفير والإرسال…', 'Encrypting & Sending…')}
                </>
              ) : (
                <>
                  <Check size={18} />
                  {t('إرسال طلب التوثيق', 'Submit Verification Request')}
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );

  if (standalone) {
    return modalBody;
  }

  return (
    <div className="kyc-modal-overlay">
      {modalBody}
    </div>
  );
}

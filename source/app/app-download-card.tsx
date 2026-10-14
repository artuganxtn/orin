'use client';
import React, { useState } from 'react';
import { Download, Smartphone, Apple, Sparkles, X, CheckCircle2, Share } from 'lucide-react';
import { useOrin } from './orin-settings';

export function AppDownloadCard({ compact = false }: { compact?: boolean }) {
  const { t } = useOrin();
  const [showIosModal, setShowIosModal] = useState(false);

  const handleIosClick = (e: React.MouseEvent) => {
    // If not on standalone Safari, show the quick iOS guide modal
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    if (!isIos) {
      // On desktop or android, let user see the guide or download profile
      setShowIosModal(true);
    }
  };

  if (compact) {
    return (
      <div className="auth-app-download-compact" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#94a3b8', textAlign: 'center', fontWeight: 500 }}>
          {t('أو حمّل التطبيق المباشر على هاتفك', 'Or download the official mobile app')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <a
            href="/downloads/ORIN-Android-1.6.2.apk"
            download="ORIN-Android-1.6.2.apk"
            className="app-dl-btn app-dl-android"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'var(--orin-surface-soft, rgba(32, 183, 146, 0.12))',
              border: '1px solid #10b981',
              color: '#059669',
              textDecoration: 'none',
              fontSize: '13px',
              fontWeight: 700,
              transition: 'all 0.2s ease'
            }}
          >
            <Smartphone size={16} />
            <span>Android (APK)</span>
          </a>

          <a
            href="/orin.mobileconfig"
            onClick={handleIosClick}
            className="app-dl-btn app-dl-ios"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'var(--orin-surface-soft, rgba(7, 136, 255, 0.12))',
              border: '1px solid var(--orin-line, #0788ff)',
              color: 'var(--orin-ink, #0284c7)',
              textDecoration: 'none',
              fontSize: '13px',
              fontWeight: 700,
              transition: 'all 0.2s ease'
            }}
          >
            <Apple size={16} />
            <span>Apple iOS</span>
          </a>
        </div>

        {showIosModal && (
          <IosInstallModal onClose={() => setShowIosModal(false)} t={t} />
        )}
      </div>
    );
  }

  return (
    <section
      className="home-app-download-card"
      style={{
        margin: '16px 0',
        padding: '20px',
        borderRadius: '20px',
        background: 'linear-gradient(135deg, rgba(16, 25, 66, 0.85) 0%, rgba(8, 22, 45, 0.95) 100%)',
        border: '1px solid rgba(56, 189, 248, 0.2)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-40px',
          right: '-40px',
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.15), transparent 70%)',
          pointerEvents: 'none'
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #0788ff, #0056b3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(7, 136, 255, 0.35)'
            }}
          >
            <Smartphone size={22} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                {t('تطبيق ORIN للجوال', 'ORIN Mobile Apps')}
              </h3>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '100px',
                  background: 'rgba(32, 183, 146, 0.2)',
                  color: '#34d399',
                  border: '1px solid rgba(32, 183, 146, 0.4)'
                }}
              >
                v1.6.2 Live
              </span>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#94a3b8' }}>
              {t('تداول فوري وأسعار حية مستقرة على أجهزة Android و iOS', 'Live market updates, fast execution, and native performance')}
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        {/* Android APK Download */}
        <a
          href="/downloads/ORIN-Android-1.6.2.apk"
          download="ORIN-Android-1.6.2.apk"
          className="app-download-btn-android"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(32, 183, 146, 0.18), rgba(16, 172, 137, 0.08))',
            border: '1px solid rgba(32, 183, 146, 0.35)',
            textDecoration: 'none',
            color: '#fff',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(32, 183, 146, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Smartphone size={20} color="#34d399" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc' }}>
                {t('تحميل لأجهزة أندرويد', 'Download for Android')}
              </div>
              <div style={{ fontSize: '11px', color: '#34d399', fontWeight: 500 }}>
                {t('ملف APK رسمي مباشر (12.8 MB)', 'Official APK Direct (12.8 MB)')}
              </div>
            </div>
          </div>
          <Download size={18} color="#34d399" />
        </a>

        {/* Apple iOS Download */}
        <a
          href="/orin.mobileconfig"
          onClick={handleIosClick}
          className="app-download-btn-ios"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            textDecoration: 'none',
            color: '#fff',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Apple size={20} color="#f8fafc" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc' }}>
                {t('تثبيت لأجهزة آبل iOS', 'Install for Apple iOS')}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>
                {t('تثبيت الشاشة الرئيسية / WebClip', 'Home Screen WebClip / Profile')}
              </div>
            </div>
          </div>
          <Sparkles size={18} color="#38bdf8" />
        </a>
      </div>

      {showIosModal && (
        <IosInstallModal onClose={() => setShowIosModal(false)} t={t} />
      )}
    </section>
  );
}

function IosInstallModal({ onClose, t }: { onClose: () => void; t: (ar: string, en?: string) => string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          background: '#0f172a',
          borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          padding: '24px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          <X size={18} />
        </button>

        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #0788ff, #0056b3)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px'
            }}
          >
            <Apple size={30} color="#fff" />
          </div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
            {t('تثبيت تطبيق ORIN على آيفون وآيباد', 'Install ORIN on iPhone & iPad')}
          </h3>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#94a3b8' }}>
            {t('اختر الطريقة الأنسب لك لتشغيل التطبيق كشاشة كاملة', 'Choose the best method to run as full-screen app')}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Method 1: Safari Add to Home Screen */}
          <div
            style={{
              padding: '14px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Share size={16} color="#38bdf8" />
              <strong style={{ fontSize: '14px', color: '#38bdf8' }}>
                {t('الطريقة الأولى: الإضافة إلى الشاشة الرئيسية (موصى بها)', 'Method 1: Add to Home Screen (Recommended)')}
              </strong>
            </div>
            <ol style={{ margin: '0', paddingRight: '20px', paddingLeft: '20px', fontSize: '12px', color: '#cbd5e1', lineHeight: '1.6' }}>
              <li>{t('افتح الموقع في متصفح Safari.', 'Open the site in Safari.')}</li>
              <li>{t('اضغط على زر المشاركة (Share) أسفل المتصفح.', 'Tap the Share icon at bottom of Safari.')}</li>
              <li>{t('اختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen).', 'Select "Add to Home Screen".')}</li>
              <li>{t('اضغط "إضافة" وسيظهر تطبيق ORIN على هاتفك فوراً.', 'Tap "Add" to get the standalone ORIN icon.')}</li>
            </ol>
          </div>

          {/* Method 2: Download MobileConfig */}
          <div
            style={{
              padding: '14px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <CheckCircle2 size={16} color="#34d399" />
              <strong style={{ fontSize: '14px', color: '#34d399' }}>
                {t('الطريقة الثانية: تثبيت ملف التعريف المباشر', 'Method 2: Install Configuration Profile')}
              </strong>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#cbd5e1' }}>
              {t('تثبيت ملف تعريف Apple WebClip لإنشاء أيقونة التطبيق تلقائيًا.', 'Install the signed Apple WebClip profile to add the app icon.')}
            </p>
            <a
              href="/orin.mobileconfig"
              download="orin.mobileconfig"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '10px',
                borderRadius: '10px',
                background: '#0788ff',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '13px'
              }}
            >
              {t('تحميل ملف تعريف iOS (.mobileconfig)', 'Download iOS Profile (.mobileconfig)')}
            </a>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: '16px',
            width: '100%',
            padding: '10px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: '#94a3b8',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          {t('إغلاق', 'Close')}
        </button>
      </div>
    </div>
  );
}

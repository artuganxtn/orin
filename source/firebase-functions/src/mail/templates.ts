export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function baseLayout(title: string, bodyContentHtml: string, locale: 'ar' | 'en' = 'ar', footerExtraHtml = ''): string {
  const isRtl = locale === 'ar';
  const dir = isRtl ? 'rtl' : 'ltr';

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #030814; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; direction: ${dir}; text-align: ${isRtl ? 'right' : 'left'}; -webkit-font-smoothing: antialiased; }
    .wrapper { padding: 30px 12px; background-color: #030814; }
    .container { max-width: 560px; margin: 0 auto; background-color: #0b172e; border: 1px solid #162c54; border-radius: 24px; overflow: hidden; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6); }
    .header { padding: 32px 24px 20px; text-align: center; border-bottom: 1px solid #14284b; background: linear-gradient(180deg, #0e2247 0%, #0b172e 100%); }
    .header img { width: 52px; height: 52px; margin-bottom: 8px; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 800; color: #ffffff; letter-spacing: 2px; }
    .header span { display: block; font-size: 11px; color: #00d2ff; font-weight: 700; letter-spacing: 1.5px; margin-top: 2px; }
    .content { padding: 32px 28px; font-size: 15px; line-height: 1.8; color: #d6e4fc; }
    .content h2 { margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #ffffff; }
    .code-box { font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #00f2fe; background: #040d21; border: 2px dashed #00d2ff; border-radius: 18px; padding: 20px; text-align: center; margin: 24px 0; font-family: 'Courier New', Courier, monospace; text-shadow: 0 0 12px rgba(0, 242, 254, 0.3); }
    .footer { padding: 24px 28px; text-align: center; font-size: 12px; line-height: 1.6; color: #728cb5; border-top: 1px solid #14284b; background: #060e1f; }
    .footer a { color: #00d2ff; text-decoration: none; font-weight: 600; }
    .warn-box { background: #261b0c; border: 1px solid #634315; color: #f2cb7c; padding: 14px 18px; border-radius: 14px; margin-top: 20px; font-size: 13.5px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="https://orin-trader.top/brand/orin-mark.png" alt="ORIN Logo" width="52" height="52">
        <h1>ORIN</h1>
        <span>CERTIFIED TRADING PLATFORM</span>
      </div>
      <div class="content">
        ${bodyContentHtml}
      </div>
      <div class="footer">
        <p style="margin: 0 0 6px 0; font-weight: 700; color: #8ea9d4;">${isRtl ? 'منصة ORIN للتداول المعتمد' : 'ORIN Certified Trading Platform'}</p>
        <p style="margin: 0 0 10px 0;">${isRtl ? 'هذه الرسالة آليّة ومعدّة تلقائياً، يرجى عدم الرد على هذا البريد. للحصول على الدعم والمساعدة، يرجى استخدام المساعد الذكي Adam داخل التطبيق.' : 'This is an automated notification. Please do not reply directly to this email. For support and assistance, please use Adam AI Assistant inside the ORIN app.'}</p>
        <p style="margin: 0;"><a href="https://orin-trader.top">${isRtl ? 'فتح منصة ORIN' : 'Open ORIN Platform'}</a> ${footerExtraHtml}</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function renderEmailTemplate(
  template: string,
  locale: 'ar' | 'en' = 'ar',
  payload: Record<string, any> = {}
): RenderedEmail {
  const isAr = locale === 'ar';

  if (template === 'signup_code') {
    const code = String(payload.code || '000000');
    const subject = isAr ? 'رمز إنشاء حساب ORIN الخاص بك' : 'Your ORIN Account Verification Code';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'تأكيد البريد الإلكتروني' : 'Verify Your Email'}</h2>
       <p>${isAr ? 'استخدم رمز التحقق التالي لتأكيد بريدك الإلكتروني وإنشاء حسابك في منصة ORIN:' : 'Use the following verification code to confirm your email address and create your ORIN account:'}</p>
       <div class="code-box">${escapeHtml(code)}</div>
       <p style="font-size:13px;color:#8ba5cb;">${isAr ? 'الرمز صالح لمدة 10 دقائق واستخدام واحد فقط. لا تشارك الرمز مع أي شخص.' : 'The code is valid for 10 minutes for single use. Do not share it with anyone.'}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'رمز التحقق الخاص بك:' : 'Your verification code:'} ${code}\n${isAr ? 'صالح لمدة 10 دقائق.' : 'Valid for 10 minutes.'}`;
    return { subject, html, text };
  }

  if (template === 'password_reset_code') {
    const code = String(payload.code || '000000');
    const subject = isAr ? 'رمز إعادة تعيين كلمة المرور - ORIN' : 'ORIN Password Reset Code';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'إعادة تعيين كلمة المرور' : 'Reset Your Password'}</h2>
       <p>${isAr ? 'استخدم رمز التأكيد التالي لإعادة تعيين كلمة المرور الخاصة بحسابك في منصة ORIN:' : 'Use the following verification code to reset your ORIN account password:'}</p>
       <div class="code-box">${escapeHtml(code)}</div>
       <p style="font-size:13px;color:#8ba5cb;">${isAr ? 'الرمز صالح لمدة 10 دقائق واستخدام واحد فقط. إذا لم تطلب إعادة التعيين، يرجى تجاهل هذه الرسالة.' : 'The code is valid for 10 minutes for single use. If you did not request a password reset, please ignore this email.'}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'رمز إعادة تعيين كلمة المرور:' : 'Password reset code:'} ${code}\n${isAr ? 'صالح لمدة 10 دقائق.' : 'Valid for 10 minutes.'}`;
    return { subject, html, text };
  }

  if (template === 'welcome') {
    const name = escapeHtml(payload.name || 'User');
    const subject = isAr ? 'أهلاً بك في منصة ORIN للتداول المعتمد' : 'Welcome to ORIN Trading Platform';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? `أهلاً بك، ${name}!` : `Welcome, ${name}!`}</h2>
       <p>${isAr ? 'تم تفعيل حسابك بنجاح في منصة ORIN. يمكنك الآن استكشاف الأسواق، استخدام الحساب التجريبي، أو إيداع الأموال لبدء التداول الفعلي.' : 'Your account has been successfully activated on ORIN. You can now explore markets, practice on demo, or deposit funds to trade live.'}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? `أهلاً بك ${name}!` : `Welcome ${name}!`}\n${isAr ? 'تم تفعيل حسابك بنجاح.' : 'Your account is active.'}`;
    return { subject, html, text };
  }

  if (template === 'login_new_device') {
    const revokeLink = escapeHtml(payload.revokeLink || 'https://orin-trader.top/settings/security');
    const ip = escapeHtml(payload.ip || 'Unknown IP');
    const subject = isAr ? 'تنبيه أمان: تسجيل دخول من جهاز جديد' : 'Security Alert: New Device Login';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'تم تسجيل الدخول من جهاز جديد' : 'New Device Login Detected'}</h2>
       <p>${isAr ? `تم تسجيل الدخول لحسابك مؤخراً من العنوان (${ip}).` : `Your account was logged in from IP address (${ip}).`}</p>
       <div class="warn-box">
         ${isAr ? 'إذا لم تكن أنت من قام بهذا الإجراء، اضغط على الرابط التالي فوراً لإبطال كافة الجلسات وحماية حسابك:' : 'If this was not you, click the link below immediately to revoke all active sessions:'}
         <br><br>
         <a href="${revokeLink}" style="color:#00f2fe;font-weight:bold;">${isAr ? 'إبطال كافة الجلسات وحماية الحساب' : 'Revoke All Sessions & Protect Account'}</a>
       </div>`,
      locale
    );
    const text = `${subject}\n\nIP: ${ip}\n${isAr ? 'لإبطال الجلسات:' : 'To revoke sessions:'} ${revokeLink}`;
    return { subject, html, text };
  }

  if (template === 'password_changed') {
    const subject = isAr ? 'تم تغيير كلمة المرور لحسابك' : 'Your ORIN Password Was Changed';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'تغيير كلمة المرور' : 'Password Changed'}</h2>
       <p>${isAr ? 'تم تغيير كلمة المرور الخاصة بحسابك بنجاح. تم إبطال كافة الجلسات النشطة لسلامتك.' : 'Your account password was successfully changed. All active sessions have been revoked for your security.'}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'تم تغيير كلمة المرور بنجاح.' : 'Password changed successfully.'}`;
    return { subject, html, text };
  }

  if (template === 'withdrawal_code') {
    const code = String(payload.code || '000000');
    const amountUsd = escapeHtml(payload.amountUsd || '0.00');
    const coin = escapeHtml(payload.coin || 'USDT');
    const address = escapeHtml(payload.address || '—');
    const isNewAddress = payload.isNewAddress === true;

    const subject = isAr ? 'رمز تأكيد طلب السحب' : 'ORIN Withdrawal Verification Code';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'تأكيد طلب السحب' : 'Confirm Withdrawal Request'}</h2>
       <p>${isAr ? `رمز التأكيد الخاص بطلب سحب <b>$${amountUsd} USD</b> عبر شبكة ${coin} إلى المحفظة (${address}):` : `Your verification code for withdrawing <b>$${amountUsd} USD</b> via ${coin} to wallet (${address}):`}</p>
       <div class="code-box">${escapeHtml(code)}</div>
       ${isNewAddress ? `<div class="warn-box">⚠️ ${isAr ? 'تنبيه: هذا العنوان يُستخدم لأول مرة على حسابك. تأكد من صحة العنوان والشبكة قبل الإدخال.' : 'Notice: This wallet address is being used for the first time on your account. Verify address & network carefully.'}</div>` : ''}`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'رمز السحب:' : 'Withdrawal code:'} ${code}\n${isAr ? 'المبلغ:' : 'Amount:'} $${amountUsd} USD`;
    return { subject, html, text };
  }

  if (template === 'withdrawal_requested') {
    const amountUsd = escapeHtml(payload.amountUsd || '0.00');
    const coin = escapeHtml(payload.coin || 'USDT');
    const subject = isAr ? 'تم استلام طلب السحب' : 'Withdrawal Request Received';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'استلام طلب السحب' : 'Withdrawal Request Received'}</h2>
       <p>${isAr ? `تم استلام طلب سحب <b>$${amountUsd} USD</b> عبر ${coin} وهو الآن قيد المراجعة والتدقيق.` : `Your request to withdraw <b>$${amountUsd} USD</b> via ${coin} has been received and is under compliance review.`}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'تم استلام طلب السحب بقيمة:' : 'Withdrawal request received for:'} $${amountUsd} USD`;
    return { subject, html, text };
  }

  if (template === 'withdrawal_approved') {
    const amountUsd = escapeHtml(payload.amountUsd || '0.00');
    const subject = isAr ? 'تمت الموافقة على طلب السحب' : 'Withdrawal Approved';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'موافقة على السحب' : 'Withdrawal Approved'}</h2>
       <p>${isAr ? `تمت الموافقة المالية على طلب سحب <b>$${amountUsd} USD</b> وجارٍ تجهيز التحويل على الشبكة.` : `Your withdrawal of <b>$${amountUsd} USD</b> has been approved and is being prepared for blockchain transfer.`}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'تمت الموافقة على السحب بقيمة:' : 'Approved withdrawal:'} $${amountUsd} USD`;
    return { subject, html, text };
  }

  if (template === 'withdrawal_paid') {
    const amountUsd = escapeHtml(payload.amountUsd || '0.00');
    const txHash = escapeHtml(payload.txHash || '—');
    const subject = isAr ? 'تم تنفيذ واكتمال عملية السحب' : 'Withdrawal Completed & Paid';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'اكتمل السحب بنجاح' : 'Withdrawal Completed'}</h2>
       <p>${isAr ? `تم تحويل مبلغ <b>$${amountUsd} USD</b> إلى محفظتك بنجاح.` : `Your withdrawal of <b>$${amountUsd} USD</b> was completed and sent to your wallet.`}</p>
       <p style="font-family:monospace;background:#040b18;padding:12px;border-radius:10px;color:#00f2fe;">TxID: ${txHash}</p>`,
      locale
    );
    const text = `${subject}\n\nTxID: ${txHash}`;
    return { subject, html, text };
  }

  if (template === 'deposit_confirmed') {
    const amountUsd = escapeHtml(payload.amountUsd || '0.00');
    const subject = isAr ? 'تأكيد إيداع ورصيد مضاف' : 'Deposit Confirmed & Credited';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'تم إضافة الإيداع' : 'Deposit Credited'}</h2>
       <p>${isAr ? `تم تأكيد إيداعك بقيمة <b>$${amountUsd} USD</b> وإضافته مباشرة لحسابك الحقيقي.` : `Your deposit of <b>$${amountUsd} USD</b> was confirmed and credited to your real account.`}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'مبلغ الإيداع المضاف:' : 'Credited deposit:'} $${amountUsd} USD`;
    return { subject, html, text };
  }

  if (template === 'kyc_approved') {
    const subject = isAr ? 'تهانينا: تم التوثيق الرسمي لهويتك' : 'KYC Verification Approved';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'حسابك موثّق رسمياً' : 'Account Officially Verified'}</h2>
       <p>${isAr ? 'تمت مراجعة وثائق الهوية الخاصة بك والتحقق منها بنجاح. جميع الميزات المالية مفعّلة الآن بحسابك.' : 'Your identity documents have been verified. All financial operations are now fully enabled.'}</p>`,
      locale
    );
    const text = `${subject}\n\n${isAr ? 'تم توثيق حسابك بنجاح.' : 'Account officially verified.'}`;
    return { subject, html, text };
  }

  if (template === 'kyc_rejected') {
    const reason = escapeHtml(payload.reason || 'المستند غير واضح');
    const subject = isAr ? 'ملاحظة بشأن طلب توثيق الهوية' : 'Update on Your KYC Verification';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'يتطلب توثيق الهوية مراجعة' : 'KYC Update Required'}</h2>
       <p>${isAr ? `لم يكتمل التوثيق بالسبب التالي: <b>${reason}</b>.` : `Verification was not completed due to: <b>${reason}</b>.`}</p>
       <p>${isAr ? 'يمكنك رفع صورة واضحة ومطابقة مجدداً عبر قسم توثيق الهوية.' : 'You can upload a clear matching document again under Identity Verification.'}</p>`,
      locale
    );
    const text = `${subject}\n\n${reason}`;
    return { subject, html, text };
  }

  if (template === 'daily_reminder') {
    const unsubscribeToken = escapeHtml(payload.unsubscribeToken || '');
    const balanceUsd = escapeHtml(payload.balanceUsd || '0.00');
    const openPositions = Number(payload.openPositions || 0);
    const kycStatus = escapeHtml(payload.kycStatus || 'unsubmitted');

    const unsubscribeUrl = `https://orin-trader.top/api/email/unsubscribe?token=${unsubscribeToken}`;
    const footerExtra = `<br><br><a href="${unsubscribeUrl}">${isAr ? 'إلغاء الاشتراك من التذكير اليومي' : 'Unsubscribe from daily reminder'}</a>`;

    const subject = isAr ? 'ملخص حسابك اليومي - ORIN' : 'Your Daily ORIN Account Summary';
    const html = baseLayout(
      subject,
      `<h2>${isAr ? 'ملخص الحساب اليومي' : 'Daily Account Summary'}</h2>
       <p>${isAr ? 'إليك ملخص حالة حسابك اليومية:' : 'Here is your daily account summary:'}</p>
       <ul>
         <li><b>${isAr ? 'الرصيد المتاح:' : 'Available Balance:'}</b> $${balanceUsd} USD</li>
         <li><b>${isAr ? 'المراكز المفتوحة:' : 'Open Positions:'}</b> ${openPositions}</li>
         <li><b>${isAr ? 'حالة التوثيق:' : 'KYC Status:'}</b> ${kycStatus}</li>
       </ul>`,
      locale,
      footerExtra
    );
    const text = `${subject}\n\nBalance: $${balanceUsd} USD\nUnsubscribe: ${unsubscribeUrl}`;
    return { subject, html, text };
  }

  const subject = `ORIN Notification - ${template}`;
  const html = baseLayout(subject, `<p>Notification update.</p>`, locale);
  const text = `${subject}\nNotification update.`;
  return { subject, html, text };
}

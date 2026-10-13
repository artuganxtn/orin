import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function getSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST || 'smtp.titan.email';
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = process.env.SMTP_SECURE === 'false' ? false : (port === 465);
  const user = process.env.SMTP_USER || process.env.ORIN_MAIL_FROM || 'support@javl900.com';
  const pass = process.env.SMTP_PASS || process.env.TITAN_PASSWORD || process.env.ORIN_MAIL_API_KEY || '';
  let from = (process.env.SMTP_FROM || '').trim();
  if (!from) {
    from = `"ORIN Trading" <${user}>`;
  } else if (!from.includes('@')) {
    // If only display name provided, append valid mailbox
    from = `"${from.replace(/"/g, '')}" <${user}>`;
  }

  return { host, port, secure, user, pass, from };
}

let transporterInstance: any = null;

export function getMailer(): any {
  const config = getSmtpConfig();
  if (!transporterInstance) {
    transporterInstance = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporterInstance;
}

export function resetMailer() {
  transporterInstance = null;
}

/**
 * Premium bilingual HTML template for OTP verification code
 */
export function renderOtpEmailHtml(code: string): string {
  const logoUrl = 'https://orin-trader.top/brand/orin-mark.png';
  const appUrl = 'https://orin-trader.top';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>رمز التحقق - ORIN</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #040812;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #e2e8f0;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #040812;
      padding: 40px 10px;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background: linear-gradient(180deg, #0a1324 0%, #070d18 100%);
      border: 1px solid rgba(0, 210, 255, 0.2);
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(0, 150, 255, 0.1);
    }
    .header {
      padding: 36px 30px 24px;
      text-align: center;
      background: radial-gradient(ellipse at top, rgba(0, 170, 255, 0.15) 0%, transparent 70%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .logo-img {
      width: 64px;
      height: 64px;
      display: inline-block;
      margin-bottom: 12px;
      filter: drop-shadow(0 0 16px rgba(0, 210, 255, 0.5));
    }
    .brand-title {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 4px;
      color: #ffffff;
      margin: 0;
    }
    .brand-subtitle {
      font-size: 11px;
      letter-spacing: 3px;
      color: #00d2ff;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .content {
      padding: 36px 34px;
      text-align: center;
    }
    .headline {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 14px;
      line-height: 1.4;
    }
    .subtext {
      font-size: 14px;
      line-height: 1.8;
      color: #94a3b8;
      margin: 0 0 28px;
    }
    .code-box-outer {
      margin: 32px 0;
      display: inline-block;
      width: 100%;
    }
    .code-box {
      background: #030712;
      border: 2px solid #00d2ff;
      border-radius: 18px;
      padding: 22px 28px;
      display: inline-block;
      box-shadow: 0 0 35px rgba(0, 210, 255, 0.25), inset 0 0 15px rgba(0, 210, 255, 0.1);
    }
    .code-text {
      font-family: 'SF Mono', Monaco, Consolas, 'Courier New', monospace;
      font-size: 42px;
      font-weight: 800;
      letter-spacing: 14px;
      color: #00f2fe;
      margin: 0;
      text-indent: 14px;
      direction: ltr;
    }
    .expiry-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      border-radius: 20px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      font-size: 12px;
      font-weight: 600;
      margin-top: 10px;
    }
    .security-notice {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 14px;
      padding: 16px 20px;
      margin-top: 28px;
      text-align: right;
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.7;
    }
    .security-notice b {
      color: #e2e8f0;
    }
    .en-section {
      direction: ltr;
      text-align: center;
      margin-top: 28px;
      padding-top: 24px;
      border-top: 1px dashed rgba(255, 255, 255, 0.08);
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
    }
    .footer {
      background: #03060d;
      padding: 26px 30px;
      text-align: center;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 12px;
      color: #64748b;
    }
    .footer a {
      color: #00d2ff;
      text-decoration: none;
      font-weight: 600;
    }
    .footer-links {
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="${logoUrl}" alt="ORIN Logo" class="logo-img" />
        <h1 class="brand-title">ORIN</h1>
        <div class="brand-subtitle">Trading Platform</div>
      </div>
      <div class="content">
        <h2 class="headline">رمز التحقق لتأكيد الحساب</h2>
        <p class="subtext">
          استخدم الرمز التالي لإتمام عملية تسجيل الدخول أو تأكيد حسابك على منصة ORIN:
        </p>
        <div class="code-box-outer">
          <div class="code-box">
            <div class="code-text">${code}</div>
          </div>
        </div>
        <div>
          <span class="expiry-badge">⏱ صالح لمدة 10 دقائق فقط</span>
        </div>
        <div class="security-notice">
          <b>تنبيه أمني هام:</b> لا تشارك هذا الرمز مع أي شخص. موظفو ORIN لن يطلبوا منك هذا الرمز أبدًا. إذا لم تكن قد طلبت هذا الرمز، يُرجى تجاهل هذه الرسالة وتأمين بريدك.
        </div>
        <div class="en-section">
          <p style="margin: 0 0 6px 0; color: #94a3b8;">
            Your ORIN verification code is: <strong>${code}</strong> (Expires in 10 minutes).
          </p>
          <p style="margin: 0; color: #64748b;">
            Do not share this code with anyone. If you did not request this, please ignore this email.
          </p>
        </div>
      </div>
      <div class="footer">
        <div>ORIN Financial Technologies &bull; <a href="${appUrl}">orin-trader.top</a></div>
        <div class="footer-links">
          هذه الرسالة آليّة؛ يرجى عدم الرد. للدعم والمساعدة، استخدم المساعد الذكي في التطبيق.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Premium HTML template for Welcome Email
 */
export function renderWelcomeEmailHtml(name: string): string {
  const logoUrl = 'https://orin-trader.top/brand/orin-mark.png';
  const appUrl = 'https://orin-trader.top';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مرحبًا بك في ORIN</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #040812;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #e2e8f0;
    }
    .wrapper {
      width: 100%;
      background-color: #040812;
      padding: 40px 10px;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background: linear-gradient(180deg, #0a1324 0%, #070d18 100%);
      border: 1px solid rgba(0, 210, 255, 0.2);
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .header {
      padding: 40px 30px 24px;
      text-align: center;
      background: radial-gradient(ellipse at top, rgba(0, 170, 255, 0.2) 0%, transparent 70%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .logo-img {
      width: 72px;
      height: 72px;
      display: inline-block;
      margin-bottom: 14px;
      filter: drop-shadow(0 0 20px rgba(0, 210, 255, 0.6));
    }
    .brand-title {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: 5px;
      color: #ffffff;
      margin: 0;
    }
    .content {
      padding: 38px 34px;
      text-align: right;
    }
    .greeting {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 16px;
    }
    .greeting span {
      color: #00d2ff;
    }
    .intro-p {
      font-size: 14px;
      line-height: 1.9;
      color: #94a3b8;
      margin: 0 0 26px;
    }
    .feature-card {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(0, 210, 255, 0.15);
      border-radius: 16px;
      padding: 18px 22px;
      margin-bottom: 16px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .feature-title {
      font-size: 15px;
      font-weight: 700;
      color: #f1f5f9;
      margin: 0 0 5px;
    }
    .feature-desc {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.6;
      margin: 0;
    }
    .cta-container {
      text-align: center;
      margin: 36px 0 20px;
    }
    .cta-btn {
      display: inline-block;
      background: linear-gradient(135deg, #00d2ff 0%, #0077ff 100%);
      color: #030712 !important;
      font-weight: 800;
      font-size: 16px;
      padding: 16px 38px;
      border-radius: 14px;
      text-decoration: none;
      box-shadow: 0 10px 30px rgba(0, 210, 255, 0.35);
    }
    .footer {
      background: #03060d;
      padding: 26px 30px;
      text-align: center;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 12px;
      color: #64748b;
    }
    .footer a {
      color: #00d2ff;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="${logoUrl}" alt="ORIN Logo" class="logo-img" />
        <h1 class="brand-title">ORIN</h1>
      </div>
      <div class="content">
        <h2 class="greeting">أهلاً بك <span>${name || 'معنا'}</span> في عالم ORIN</h2>
        <p class="intro-p">
          يسعدنا انضمامك إلى منصة ORIN للتداول. حسابك أصبح جاهزًا ومفعلاً لتجربة الجيل القادم من التداول المالي الذكي.
        </p>

        <div class="feature-card">
          <div>
            <div class="feature-title">⚡ حساب تجريبي وحقيقي متكامل</div>
            <p class="feature-desc">استكشف استراتيجياتك في بيئة آمنة بالحساب التجريبي أو تداول على أصولك المفضلة مباشرة.</p>
          </div>
        </div>

        <div class="feature-card">
          <div>
            <div class="feature-title">🔒 أمان عالي المستوى</div>
            <p class="feature-desc">حماية مشددة لبياناتك وعملياتك، ودعم كامل لمفاتيح المرور والتحقق بخطوتين.</p>
          </div>
        </div>

        <div class="feature-card">
          <div>
            <div class="feature-title">💬 دعم فني مخصص</div>
            <p class="feature-desc">فريقنا معك على مدار الساعة عبر محادثة الدعم المباشرة داخل التطبيق أو عبر البريد.</p>
          </div>
        </div>

        <div class="cta-container">
          <a href="${appUrl}" class="cta-btn">ابدأ التداول الآن &larr;</a>
        </div>
      </div>
      <div class="footer">
        <div>منصة ORIN &bull; <a href="${appUrl}">orin-trader.top</a></div>
        <div style="margin-top: 8px;">
          هذه الرسالة آليّة؛ يرجى عدم الرد. للدعم والمساعدة، استخدم المساعد الذكي في التطبيق.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send an OTP verification code email using Titan SMTP
 */
export async function sendOtpEmail(to: string, code: string, challengeId: string): Promise<void> {
  const config = getSmtpConfig();
  const mailer = getMailer();

  const mailOptions = {
    from: config.from,
    to,
    subject: `ORIN - رمز التحقق: ${code}`,
    text: `رمز التحقق لإنشاء وتأكيد حساب ORIN: ${code}\nينتهي خلال 10 دقائق.\nلا تشارك هذا الرمز مع أي شخص.\nYour ORIN verification code: ${code}. Valid for 10 minutes.`,
    html: renderOtpEmailHtml(code),
    headers: {
      'X-Entity-Ref-ID': challengeId,
    },
  };

  await mailer.sendMail(mailOptions);
}

/**
 * Send a welcome email to newly registered users
 */
export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const config = getSmtpConfig();
  const mailer = getMailer();

  const mailOptions = {
    from: config.from,
    to,
    subject: 'مرحبًا بك في منصة ORIN | Welcome to ORIN Trading',
    text: `أهلاً بك ${name} في ORIN!\nتم تفعيل حسابك بنجاح.\nيمكنك تسجيل الدخول وبدء التداول عبر https://orin-trader.top`,
    html: renderWelcomeEmailHtml(name),
  };

  await mailer.sendMail(mailOptions);
}

import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function normalizeFromAddress(raw: string, fallbackUser: string): string {
  let s = (raw || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (!s) {
    return `"ORIN Trading" <${fallbackUser}>`;
  }
  const match = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, '').trim();
    const email = match[2].trim();
    return name ? `"${name}" <${email}>` : email;
  }
  if (s.includes('@')) {
    return `"ORIN Trading" <${s.replace(/^["']|["']$/g, '').trim()}>`;
  }
  return `"${s.replace(/^["']|["']$/g, '').trim()}" <${fallbackUser}>`;
}

export function getSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST || 'smtp.titan.email';
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = process.env.SMTP_SECURE === 'false' ? false : (port === 465);
  const user = process.env.SMTP_USER || process.env.ORIN_MAIL_FROM || 'support@javl900.com';
  const pass = process.env.SMTP_PASS || process.env.TITAN_PASSWORD || process.env.ORIN_MAIL_API_KEY || '';
  const from = normalizeFromAddress(process.env.SMTP_FROM || process.env.ORIN_MAIL_FROM || user, user);

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
export function renderOtpEmailHtml(
  code: string,
  headline = 'رمز التحقق لتأكيد الحساب',
  subtext = 'استخدم الرمز التالي لإتمام عملية تسجيل الدخول أو تأكيد حسابك على منصة ORIN:',
  enHeadline = 'Your ORIN verification code is:'
): string {
  const logoUrl = 'https://orin-trader.top/brand/orin-mark.png';
  const appUrl = 'https://orin-trader.top';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${headline} - ORIN</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 36px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);">
          
          <!-- Header with Logo -->
          <tr>
            <td align="center" style="padding: 32px 24px 20px; border-bottom: 1px solid #f1f5f9; background-color: #ffffff;">
              <img src="${logoUrl}" alt="ORIN Logo" width="56" height="56" style="display: block; width: 56px; height: 56px; margin: 0 auto 10px; border: 0;" />
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: 2px;">ORIN</h1>
              <p style="margin: 4px 0 0; font-size: 11px; font-weight: 700; color: #0284c7; letter-spacing: 1.5px; text-transform: uppercase;">Certified Trading Platform</p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: right; direction: rtl;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.4;">${headline}</h2>
              <p style="margin: 0 0 20px; font-size: 14.5px; line-height: 1.8; color: #334155;">${subtext}</p>

              <!-- Verification Code Box -->
              <div style="margin: 24px 0; text-align: center;">
                <div style="display: inline-block; background-color: #f0f9ff; border: 2px dashed #0284c7; border-radius: 14px; padding: 16px 32px; text-align: center;">
                  <span style="font-family: 'SF Pro Mono', Monaco, Menlo, Consolas, 'Courier New', monospace; font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #0369a1; direction: ltr; display: inline-block;">${code}</span>
                </div>
                <div style="margin-top: 10px;">
                  <span style="display: inline-block; background-color: #fee2e2; border: 1px solid #fecaca; color: #991b1b; font-size: 12px; font-weight: 600; padding: 3px 12px; border-radius: 9999px;">⏱ صالح لمدة 10 دقائق فقط</span>
                </div>
              </div>

              <!-- Security Warning Box -->
              <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 14px 16px; margin: 24px 0 10px; font-size: 13px; line-height: 1.7; color: #92400e; text-align: right;">
                <strong style="color: #78350f;">⚠️ تنبيه أمان:</strong> لا تشارك هذا الرمز مع أي شخص. لن يطلب منك أي موظف من ORIN هذا الرمز أبدًا. إذا لم تكن قد طلبت هذا الرمز، يُرجى تجاهل هذا البريد.
              </div>

              <!-- English Mirror Section -->
              <div style="margin-top: 24px; padding-top: 18px; border-top: 1px dashed #e2e8f0; text-align: center; direction: ltr; font-size: 12.5px; line-height: 1.6; color: #64748b;">
                <p style="margin: 0 0 4px; color: #334155;">${enHeadline} <strong style="color: #0369a1; font-size: 15px; font-family: monospace;">${code}</strong></p>
                <p style="margin: 0; font-size: 11.5px; color: #64748b;">Valid for 10 minutes. Never share this code with anyone. If you didn't request this, ignore this email.</p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 24px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 11.5px; line-height: 1.7; color: #64748b;">
              <p style="margin: 0 0 4px; font-weight: 700; color: #334155;">منصة ORIN للتداول المعتمد</p>
              <p style="margin: 0 0 8px;">هذه الرسالة آليّة؛ يرجى عدم الرد على هذا البريد الإلكتروني. للمساعدة، استخدم الدعم المباشر داخل المنصة.</p>
              <p style="margin: 0;"><a href="${appUrl}" style="color: #0284c7; text-decoration: none; font-weight: 600;">الانتقال إلى منصة ORIN &larr;</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Premium HTML template for Welcome Email
 */
/**
 * Premium HTML template for Welcome Email (Clean White Mode)
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
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; direction: rtl; text-align: right; -webkit-font-smoothing: antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);">
          <!-- Header with Logo -->
          <tr>
            <td align="center" style="padding: 32px 24px 20px; border-bottom: 1px solid #f1f5f9; background: #ffffff;">
              <img src="${logoUrl}" alt="ORIN Logo" width="56" height="56" style="display: block; width: 56px; height: 56px; border: 0; margin-bottom: 10px;" />
              <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #0f172a; letter-spacing: 2px;">ORIN</h1>
              <span style="display: block; font-size: 11px; color: #0284c7; font-weight: 700; letter-spacing: 1.5px; margin-top: 4px;">CERTIFIED TRADING PLATFORM</span>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px 32px 24px; font-size: 15px; line-height: 1.8; color: #334155;">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #0f172a;">
                أهلاً بك، <span style="color: #0284c7;">${name || 'معنا'}</span> في عالم ORIN
              </h2>
              <p style="margin: 0 0 20px; color: #475569;">
                يسعدنا انضمامك إلى منصة ORIN للتداول المعتمد. حسابك أصبح جاهزًا ومفعلاً لتجربة التداول المالي الذكي.
              </p>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px;">
                <strong style="color: #0f172a; font-size: 14.5px;">⚡ حساب تجريبي وحقيقي متكامل</strong>
                <p style="margin: 4px 0 0; color: #64748b; font-size: 13px; line-height: 1.6;">استكشف استراتيجياتك في بيئة آمنة بالحساب التجريبي أو تداول على أصولك المفضلة مباشرة.</p>
              </div>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px;">
                <strong style="color: #0f172a; font-size: 14.5px;">🔒 أمان عالي المستوى</strong>
                <p style="margin: 4px 0 0; color: #64748b; font-size: 13px; line-height: 1.6;">حماية مشددة لبياناتك وعملياتك، ودعم كامل لمفاتيح المرور والتحقق بخطوتين.</p>
              </div>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                <strong style="color: #0f172a; font-size: 14.5px;">💬 دعم فني ذكي ومتواصل</strong>
                <p style="margin: 4px 0 0; color: #64748b; font-size: 13px; line-height: 1.6;">فريقنا معك عبر مساعد الدعم الذكي أو الدعم المباشر داخل المنصة.</p>
              </div>

              <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${appUrl}" style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 700; font-size: 15px; padding: 14px 36px; border-radius: 12px; text-decoration: none; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);">
                  ابدأ التداول الآن &larr;
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 24px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 11.5px; line-height: 1.7; color: #64748b;">
              <p style="margin: 0 0 4px; font-weight: 700; color: #334155;">منصة ORIN للتداول المعتمد</p>
              <p style="margin: 0 0 8px;">هذه الرسالة آليّة؛ يرجى عدم الرد على هذا البريد الإلكتروني. للمساعدة، استخدم الدعم المباشر داخل المنصة.</p>
              <p style="margin: 0;"><a href="${appUrl}" style="color: #0284c7; text-decoration: none; font-weight: 600;">الانتقال إلى منصة ORIN &larr;</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send an OTP verification code email using Titan SMTP
 */
export async function sendOtpEmail(to: string, code: string, challengeId: string): Promise<void> {
  const config = getSmtpConfig();
  const mailer = getMailer();
  const from = config.from;
  const domain = from.includes('@') ? from.split('@')[1].replace(/[<>]/g, '').trim() : 'javl900.com';
  const messageId = `<orin.otp.${Date.now()}.${Math.random().toString(36).substring(2, 9)}@${domain}>`;

  const mailOptions = {
    from,
    to,
    subject: `ORIN - رمز التحقق: ${code}`,
    text: `رمز التحقق الخاص بك في منصة ORIN هو: ${code}\nينتهي خلال 10 دقائق.\nلا تشارك هذا الرمز مع أي شخص.\nYour ORIN verification code: ${code}. Valid for 10 minutes.`,
    html: renderOtpEmailHtml(code),
    messageId,
    headers: {
      'X-Entity-Ref-ID': challengeId,
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
      'X-Priority': '1',
      'Importance': 'high',
      'List-Unsubscribe': '<https://orin-trader.top/settings/security>',
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
  const from = config.from;
  const domain = from.includes('@') ? from.split('@')[1].replace(/[<>]/g, '').trim() : 'javl900.com';
  const messageId = `<orin.welcome.${Date.now()}.${Math.random().toString(36).substring(2, 9)}@${domain}>`;

  const mailOptions = {
    from,
    to,
    subject: 'مرحبًا بك في منصة ORIN | Welcome to ORIN Trading',
    text: `أهلاً بك ${name} في ORIN!\nتم تفعيل حسابك بنجاح.\nيمكنك تسجيل الدخول وبدء التداول عبر https://orin-trader.top`,
    html: renderWelcomeEmailHtml(name),
    messageId,
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
      'List-Unsubscribe': '<https://orin-trader.top/settings/security>',
    },
  };

  await mailer.sendMail(mailOptions);
}

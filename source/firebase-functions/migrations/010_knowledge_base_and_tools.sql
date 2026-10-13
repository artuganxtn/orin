-- 010_knowledge_base_and_tools.sql

CREATE TABLE IF NOT EXISTS knowledge_base (
  id VARCHAR(128) PRIMARY KEY,
  category VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Knowledge Base Chunks (Purged of any compounding/guaranteed return claims)
INSERT INTO knowledge_base (id, category, title, content, keywords)
VALUES
  ('kb-trade-times', 'trading', 'مواعيد الصفقات وأكواد الدخول', 'التداول في منصة ORIN يتم عبر أكواد الصفقات المعتمدة (VIP Signal Codes) المكونة من 12 حرفاً (مثل ORIN-XXXXXXXXXXXX). تتوفر مواعيد الصفقات في الساعة 16:45، 18:30، و20:30 بتوقيت تركيا (Europe/Istanbul). تدخل الكود في بوابة التداول، وتتحدد النسبة والمدة رقمياً ومقفلة مسبقاً بالشروط.', '["كود", "صفقة", "مواعيد", "تداول", "شروط", "trade", "signal", "code"]'::jsonb),
  ('kb-deposits', 'finance', 'قواعد وأساليب الإيداع', 'الإيداع متاح للحسابات الحقيقية عبر USDT (شبكات TRC20, BEP20, ERC20) و Bitcoin و Ethereum. الحد الأدنى للإيداع هو 1,000$ USD. تذهب لقسم الإيداع، تختار الشبكة وتنسخ عنوان المحفظة المخصص لحسابك.', '["إيداع", "شحن", "رصيد", "شبكة", "USDT", "deposit", "minimum"]'::jsonb),
  ('kb-withdrawals', 'finance', 'شروط ورسوم السحب', 'السحب متاح للحسابات الحقيقية الموثقة (KYC) بعد مرور 29 يوماً من تاريخ أول إيداع مؤكد. رسوم السحب هي 25$ USDT ثابتة لكل معاملة. لا توجد عوائد مضاعفة أو أرباح يومية ثابتة.', '["سحب", "رسوم", "29 يوم", "شروط السحب", "withdraw", "holding period"]'::jsonb),
  ('kb-kyc', 'compliance', 'خطوات وتوثيق الهوية', 'توثيق الهوية (KYC) شرط أساسي للسحب والعمليات المالية. يتم إدخال الاسم بالكامل ورقم الوثيقة وتحميل صورة لبطاقة الهوية الوطنية أو جواز السفر أو رخصة القيادة من قسم الإعدادات -> توثيق الهوية.', '["توثيق", "هوية", "KYC", "جواز", "بطاقة", "verification", "passport"]'::jsonb),
  ('kb-referrals', 'program', 'برنامج الإحالات والمكافآت', 'برنامج الإحالات يمنح مكافآت عند دعوة أعضاء جديد واستثمارهم عبر رابطك الخاص. تُصرف المكافآت بعد اعتماد الإيداع وتوثيق الحساب من خادم الامتثال.', '["إحالة", "دعوة", "مكافأة", "رابط", "referral", "invite"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, keywords = EXCLUDED.keywords, updated_at = NOW();

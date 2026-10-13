-- 014_support_and_trade_slots_grants.sql

-- Ensure trade_slots table exists
CREATE TABLE IF NOT EXISTS trade_slots (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  local_time VARCHAR(8) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul',
  days_of_week JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
  asset VARCHAR(32) NOT NULL DEFAULT 'BTCUSD',
  direction VARCHAR(8) NOT NULL DEFAULT 'BUY',
  duration_sec INTEGER NOT NULL DEFAULT 60,
  settlement_bps INTEGER NOT NULL DEFAULT 850,
  eligibility VARCHAR(32) NOT NULL DEFAULT 'all',
  opens_offset_min INTEGER NOT NULL DEFAULT 0,
  closes_after_min INTEGER NOT NULL DEFAULT 60,
  mode VARCHAR(16) NOT NULL DEFAULT 'review',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure knowledge_base table exists
CREATE TABLE IF NOT EXISTS knowledge_base (
  id VARCHAR(128) PRIMARY KEY,
  category VARCHAR(64) NOT NULL DEFAULT 'general',
  title VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'published',
  reviewed BOOLEAN NOT NULL DEFAULT TRUE,
  revision INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add status, reviewed, revision columns to knowledge_base if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_base' AND column_name = 'status') THEN
    ALTER TABLE knowledge_base ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'published';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_base' AND column_name = 'reviewed') THEN
    ALTER TABLE knowledge_base ADD COLUMN reviewed BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_base' AND column_name = 'revision') THEN
    ALTER TABLE knowledge_base ADD COLUMN revision INT NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Seed default trade_slots if empty
INSERT INTO trade_slots (id, name, local_time, timezone, days_of_week, asset, direction, duration_sec, settlement_bps, eligibility, opens_offset_min, closes_after_min, mode, enabled)
VALUES
  ('slot-1645', 'الصفقة الأولى - العصر', '16:45', 'Europe/Istanbul', '[0,1,2,3,4,5,6]'::jsonb, 'BTCUSD', 'BUY', 60, 850, 'all', 0, 60, 'review', TRUE),
  ('slot-1830', 'الصفقة الثانية - المساء', '18:30', 'Europe/Istanbul', '[0,1,2,3,4,5,6]'::jsonb, 'ETHUSD', 'BUY', 120, 850, 'all', 0, 60, 'review', TRUE),
  ('slot-2030', 'صفقة وكيل أورين - الليل', '20:30', 'Europe/Istanbul', '[0,1,2,3,4,5,6]'::jsonb, 'XAUUSD', 'BUY', 180, 900, 'all', 0, 60, 'auto', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Seed default knowledge_base if empty
INSERT INTO knowledge_base (id, category, title, content, keywords, status, reviewed, revision)
VALUES
  ('kb-trade-times', 'trading', 'مواعيد الصفقات وأكواد الدخول', 'التداول في منصة ORIN يتم عبر أكواد الصفقات المعتمدة (VIP Signal Codes) المكونة من 12 حرفاً (مثل ORIN-XXXXXXXXXXXX). تتوفر مواعيد الصفقات في الساعة 16:45، 18:30، و20:30 بتوقيت تركيا (Europe/Istanbul). تدخل الكود في بوابة التداول، وتتحدد النسبة والمدة رقمياً ومقفلة مسبقاً بالشروط.', '["كود", "صفقة", "مواعيد", "تداول", "شروط", "trade", "signal", "code"]'::jsonb, 'published', TRUE, 1),
  ('kb-deposits', 'finance', 'قواعد وأساليب الإيداع', 'الإيداع متاح للحسابات الحقيقية عبر USDT (شبكات TRC20, BEP20, ERC20) و Bitcoin و Ethereum. الحد الأدنى للإيداع هو 1,000$ USD. تذهب لقسم الإيداع، تختار الشبكة وتنسخ عنوان المحفظة المخصص لحسابك.', '["إيداع", "شحن", "رصيد", "شبكة", "USDT", "deposit", "minimum"]'::jsonb, 'published', TRUE, 1),
  ('kb-withdrawals', 'finance', 'شروط ورسوم السحب', 'السحب متاح للحسابات الحقيقية الموثقة (KYC) بعد مرور 29 يوماً من تاريخ أول إيداع مؤكد. رسوم السحب هي 25$ USDT ثابتة لكل معاملة. لا توجد عوائد مضاعفة أو أرباح يومية ثابتة.', '["سحب", "رسوم", "29 يوم", "شروط السحب", "withdraw", "holding period"]'::jsonb, 'published', TRUE, 1),
  ('kb-kyc', 'compliance', 'خطوات وتوثيق الهوية', 'توثيق الهوية (KYC) شرط أساسي للسحب والعمليات المالية. يتم إدخال الاسم بالكامل ورقم الوثيقة وتحميل صورة لبطاقة الهوية الوطنية أو جواز السفر أو رخصة القيادة من قسم الإعدادات -> توثيق الهوية.', '["توثيق", "هوية", "KYC", "جواز", "بطاقة", "verification", "passport"]'::jsonb, 'published', TRUE, 1),
  ('kb-referrals', 'program', 'برنامج الإحالات والمكافآت', 'برنامج الإحالات يمنح مكافآت عند دعوة أعضاء جديد واستثمارهم عبر رابطك الخاص. تُصرف المكافآت بعد اعتماد الإيداع وتوثيق الحساب من خادم الامتثال.', '["إحالة", "دعوة", "مكافأة", "رابط", "referral", "invite"]'::jsonb, 'published', TRUE, 1)
ON CONFLICT (id) DO NOTHING;

-- Grant permissions to orin_app role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orin_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON trade_slots TO orin_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_base TO orin_app;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_runs') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_runs TO orin_app;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'telegram_outbox') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_outbox TO orin_app;
    END IF;
  END IF;
END $$;

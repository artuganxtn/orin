from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
target = root / 'deliverables/ORIN-Original-Spark.zip'
prefix = 'ORIN-Original-Spark/'
config = json.loads((root / 'firebase.spark.json').read_text())
config['hosting']['public'] = 'public'
config['firestore'] = {'rules': 'firestore.rules', 'indexes': 'firestore.indexes.json'}
config.pop('emulators', None)
assert 'functions' not in config
assert not any('function' in r for r in config['hosting']['rewrites'])
preview = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export FIREBASE_HOSTING_UPLOAD_CONCURRENCY=1
firebase deploy --project orin-99951 --only firestore:rules
firebase hosting:channel:deploy spark-review --expires 7d --project orin-99951
touch PREVIEW_READY
'''
publish = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f PREVIEW_READY ]; then
  echo 'Run bash preview.sh and test the returned Firebase preview URL first.'
  exit 1
fi
firebase hosting:clone orin-99951:spark-review orin-99951:live --project orin-99951
'''
readme = '''ORIN — الواجهة الأصلية على Firebase Spark

هذه نسخة الويب الأصلية مع Authentication وFirestore والإدارة. ليست APK.
المشروع والرابط العام يبقيان orin-99951 و https://orin-99951.web.app
لا تحتاج الحزمة إلى Blaze أو وسيلة دفع. لا تنشر Cloud Functions.

للمعاينة أولًا، ارفع هذا الملف إلى Cloud Shell ثم نفّذ:
unzip ORIN-Original-Spark.zip
cd ORIN-Original-Spark
bash preview.sh

سيظهر رابط Firebase مؤقت. لا يغيّر هذا الأمر نسخة الموقع العام.
قواعد Firestore المنشورة مشتركة بين المعاينة والموقع. قواعد users الحالية محفوظة، وتضاف قواعد النسخة الجديدة المختبرة.
حسابات Firebase الحالية تبقى صالحة. لا توجد حسابات اختبار مزروعة في قاعدة البيانات الحقيقية.

اختبر من الرابط المؤقت:
إنشاء الحساب، الدخول والخروج، الاستعادة، واجهة ORIN الأصلية، الأسواق، حفظ المظهر.
الإدارة: البريد khtaub7341@gmail.com بعد تأكيد البريد وتحديث جلسة الدخول.
/admin للمساحة الأصلية و /admin/users لإدارة المستخدمين.
المعاينة تشارك البيانات الحقيقية؛ لا ترسل إعلانات تجريبية إلى العملاء.

بعد اختبار المعاينة فقط، لنشر نفس النسخة على الرابط العام الحالي:
bash publish.sh

يعمل الآن:
الحسابات والصلاحيات، الإدارة الأساسية، الملف الشخصي، إعدادات المظهر والشارت، الإشعارات والإعلانات داخل التطبيق مع معاينة وتأكيد وقراءة الإشعارات.

ما ينتظر الخادم الآمن ولا يُنقل إلى المتصفح:
إنشاء الرصيد الافتراضي، نشر العقود وقفل الشروط، حجز الأموال للمشاركة، التسوية، إنشاء القيود والإيصالات والتدقيق المالي وإشعارات التسوية.
السجلات المالية السابقة في Firestore للقراءة فقط. لم تُحذف بيانات أو وظائف الخادم.
الأرصدة الجديدة تظهر صفرًا؛ لا ننشئ رصيد 10,000 وهميًا من المتصفح.
Push والجدولة التلقائية والأموال الحقيقية وAPK لم تكن متصلة أصلًا.

قبل أي تعديل إضافي راجع source/firebase-spark/README.md للتفاصيل الدقيقة.
الاختبارات محلية على محاكي Firebase. يلزم اختبار رابط المعاينة قبل نشره للعامة.
'''
with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=9) as z:
 def add(path, name):
  z.write(path, prefix + name)
 z.writestr(prefix + 'firebase.json', json.dumps(config, indent=2) + '\n')
 z.writestr(prefix + 'preview.sh', preview)
 z.writestr(prefix + 'publish.sh', publish)
 z.writestr(prefix + 'README-AR.txt', readme)
 add(root / 'firebase-spark/firestore.rules', 'firestore.rules')
 add(root / 'firebase-web/firestore.indexes.json', 'firestore.indexes.json')
 for p in sorted((root / 'firebase-spark-dist').rglob('*')):
  if p.is_file(): add(p, 'public/' + p.relative_to(root / 'firebase-spark-dist').as_posix())
 for name in ['app','components','lib','firebase-app','firebase-web','firebase-spark','firebase-functions/src','tests']:
  for p in sorted((root / name).rglob('*')):
   if p.is_file() and p.suffix in {'.ts','.tsx','.mts','.mjs','.css','.html','.json','.md','.rules'} and p.name!='adapter-test.mjs' and not any(s.startswith('.') for s in p.relative_to(root).parts): add(p, 'source/' + p.relative_to(root).as_posix())
 for name in ['package.json','package-lock.json','postcss.config.mjs','tsconfig.json','firebase.spark.json','firebase.original.json','firebase-functions/package.json','firebase-functions/package-lock.json','firebase-functions/build.mjs','scripts/package-firebase-spark.py']:
  add(root / name, 'source/' + name)
 for p in sorted((root / 'public').rglob('*')):
  if p.is_file(): add(p, 'source/public/' + p.relative_to(root / 'public').as_posix())
with ZipFile(target) as z:
 assert z.testzip() is None
 assert prefix + 'public/index.html' in z.namelist()
 assert not any('/node_modules/' in n or '/.env' in n or '/.git/' in n or 'firebase-debug' in n for n in z.namelist())
 print(json.dumps({'path': str(target), 'bytes': target.stat().st_size, 'files': len(z.namelist())}))

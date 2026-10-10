from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]
target=root/'deliverables/ORIN-Original-Firebase.zip'
prefix='ORIN-Original-Firebase/'
config=json.loads((root/'firebase.original.json').read_text())
config['hosting']['public']='public'
config['functions'][0]['source']='functions'
config['firestore']={'rules':'firestore.rules','indexes':'firestore.indexes.json'}
config.pop('emulators',None)
package=json.loads((root/'firebase-functions/package.json').read_text())
package['scripts']={'gcp-build':''}
readme='''ORIN — النسخة الأصلية على Firebase

هذه الحزمة تشمل واجهة ORIN الأصلية، الحسابات، لوحة الإدارة، خادم Firebase، قواعد الحماية والأصول.
المشروع: orin-99951
الرابط بعد النشر: https://orin-99951.web.app

الحالة: بُنيت واختُبرت محليًا. لم تُنشر هذه الحزمة بعد.
المشروع حاليًا Spark؛ نشر Cloud Functions يحتاج تفعيل Blaze وربط حساب فوترة بموافقة المالك. الفوترة حسب الاستخدام وليست اشتراكًا ثابتًا أو ضمانًا لعدم التكلفة.

خطوات النشر من Cloud Shell بعد تفعيل Blaze:
1. ارفع هذا الملف ثم نفّذ:
unzip ORIN-Original-Firebase.zip
cd ORIN-Original-Firebase
bash deploy.sh

ينشر السكربت الخادم وقواعد البيانات أولًا، ثم الواجهة فقط إذا نجح نشر الخادم.
إذا ظهرت مطالبة تسجيل الدخول أكملها في Google بنفسك؛ لا ترسل كلمات المرور أو رموز التفويض في المحادثة.

بعد نجاح النشر:
افتح https://orin-99951.web.app
حسابات Firebase الحالية تبقى صالحة.
حساب الإدارة المحمي: khtaub7341@gmail.com بعد تأكيد البريد والخروج ثم الدخول.
إدارة المستخدمين: الإعدادات ← مساحة الإدارة ← إدارة المستخدمين.

الاختبارات: 11 فحصًا ناجحًا، إضافة إلى اختبار HTTP حقيقي محلي يربط Hosting بالخادم وAuthentication وFirestore.
ملفات تصميم Light وشعار ORIN الأساسي مطابقة للنسخة الأصلية.

ملاحظات النطاق:
- نسخة الويب الأصلية؛ لا يوجد APK داخل الحزمة.
- العقود والأرصدة محاكاة افتراضية، كما في التطبيق الأصلي. لم يُربط إيداع أموال حقيقية أو تنفيذ سوق.
- بيانات D1 القديمة لم تُحذف ولم تُنقل تلقائيًا. الربط بين هوياتها وحسابات Firebase يحتاج ترحيلًا مستقلًا إن لزم.
- Push والمهام المجدولة وMFA غير مفعلة.
- يتضمن source ملفات المصدر اللازمة لتطوير هذه النسخة، دون مفاتيح خدمة أو بيانات دخول.
'''
deploy='''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export FIREBASE_HOSTING_UPLOAD_CONCURRENCY=1
npm --prefix functions ci --omit=dev --no-audit --no-fund
firebase deploy --project orin-99951 --only functions:orin,firestore
firebase deploy --project orin-99951 --only hosting
'''
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as z:
 def add(p,arc):z.write(p,prefix+arc)
 z.writestr(prefix+'firebase.json',json.dumps(config,indent=2)+'\n')
 z.writestr(prefix+'functions/package.json',json.dumps(package,indent=2)+'\n')
 add(root/'firebase-functions/package-lock.json','functions/package-lock.json')
 for p in sorted((root/'firebase-functions/lib').rglob('*')):
  if p.is_file():add(p,'functions/lib/'+p.relative_to(root/'firebase-functions/lib').as_posix())
 for p in sorted((root/'firebase-app-dist').rglob('*')):
  if p.is_file():add(p,'public/'+p.relative_to(root/'firebase-app-dist').as_posix())
 add(root/'firebase-web/firestore.rules','firestore.rules')
 add(root/'firebase-app/firestore.indexes.json','firestore.indexes.json')
 z.writestr(prefix+'README-AR.txt',readme)
 z.writestr(prefix+'deploy.sh',deploy)
 # Explicit source allowlist: no credentials, runtime caches, Git metadata or installed dependencies.
 for name in ['app','components','lib','firebase-app','firebase-web','firebase-functions/src','tests']:
  for p in sorted((root/name).rglob('*')):
   if p.is_file() and p.suffix in {'.ts','.tsx','.mts','.mjs','.css','.html','.json','.md'} and not any(part.startswith('.') for part in p.relative_to(root).parts):add(p,'source/'+p.relative_to(root).as_posix())
 for name in ['package.json','package-lock.json','postcss.config.mjs','tsconfig.json','firebase.original.json','firebase-functions/package.json','firebase-functions/package-lock.json','firebase-functions/build.mjs','firebase-functions/integration.test.mjs','firebase-functions/http-smoke.mjs']:
  add(root/name,'source/'+name)
 for p in (root/'public').rglob('*'):
  if p.is_file():add(p,'source/public/'+p.relative_to(root/'public').as_posix())
 add(root/'docs/firebase-blaze-required.jpg','Firebase-plan.jpg')
with ZipFile(target) as z:
 assert z.testzip() is None
 assert prefix+'public/index.html' in z.namelist()
 assert prefix+'functions/lib/index.js' in z.namelist()
 assert not any('/node_modules/' in n or '/.env' in n or '/.git/' in n or 'firebase-debug' in n for n in z.namelist())
 print(json.dumps({'path':str(target),'bytes':target.stat().st_size,'files':len(z.namelist())}))

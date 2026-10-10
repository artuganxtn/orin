#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json,hashlib,subprocess
r=Path(__file__).resolve().parents[1];out=r/'deliverables';prefix='ORIN-Startup-Review/'
with ZipFile(out/'ORIN-Backup-Before-Startup-Fix.zip') as z:before=json.loads(z.read('ORIN-Backup-Before-Startup-Fix/BASELINE-SHA256.json'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
backend=[n for n in before if n.startswith(('firebase-spark/','firebase-functions/src/','firebase-web/')) and n.endswith(('.ts','.rules','.json')) or n in ['firebase-app/account.tsx','firebase-app/security.tsx','lib/client-api.ts','firebase.spark.json','firebase.original.json']]
for n in backend:assert sha(r/n)==before[n],'Backend changed: '+n
changed=[n for n in before if (r/n).is_file() and sha(r/n)!=before[n]]
assert sha(out/'ORIN-Android-1.1.0.apk')=='f9f82243609466a2d90126a342c8aee1f98922cba8d0d44a35ad48313e71baf9'
verification={'release':'ORIN startup visual review after 1.1.0','published':False,'newApkBuilt':False,'backendFilesUnchanged':backend,'changedExistingFiles':changed,'tests':{'passed':26,'failed':0,'environment':'isolated Firebase Auth/Firestore emulators plus Node tests','startupCases':'unit simulations, not on-device cold/warm start'},'typeScript':'passed','webBuild':'passed','androidResourceCompilation':'passed','browserReview':'blocked: ERR_BLOCKED_BY_CLIENT when opening localhost:4173','actualAndroidDeviceTests':'pending','screenshots':'not captured; HTML preview is not screenshots','liveHostingChanged':False,'firebaseRulesChanged':False}
config={'hosting':json.loads((r/'firebase.spark.json').read_text())['hosting']};config['hosting']['public']='public'
preview='''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export FIREBASE_HOSTING_UPLOAD_CONCURRENCY=1
# Hosting preview only: no Firestore rules, Functions, billing or live deployment.
firebase hosting:channel:deploy startup-review --expires 7d --project orin-99951 --config firebase.json
'''
readme='''ORIN — معاينة إصلاح البداية بعد 1.1.0

هذه حزمة معاينة ويب ومصدر، وليست APK جديدًا أو إصدارًا نهائيًا.
أُخذت نسخة من المصدر قبل التعديل: ORIN-Backup-Before-Startup-Fix.zip.

المعالجة:
- Splash كاملة بهوية ORIN Navy والشعار الأصلي وعمق خفيف، دون Skeleton.
- صفحة HTML الأولى نفسها تحمل الشعار، حتى قبل تهيئة React/Firebase.
- انتظار Auth والملف والإعدادات وبيانات الصفحة الأولى قبل إظهار واجهة الحساب.
- مهلة 12 ثانية لكل محاولة تهيئة، حالة Offline، إعادة محاولة، ورفض النتائج المتأخرة.
- لا تأخير مصطنع للجلسة الجاهزة. حركة الشعار نحو 650ms وتحترم Reduce Motion.
- الشعار وخيار قائمة واحد في هيدر الحساب؛ اللغة والمظهر والإعدادات داخل القائمة.
- إزالة تذييل الإصدار والروابط من إطار الحساب/التحميل؛ صفحات الخصوصية والشروط
  ومعلومات الإصدار بقيت متاحة عبر الإعدادات، كما كانت.
- تمرير الإعدادات والبيانات المحملة إلى الواجهة الأصلية وتحديث النسخة بالذاكرة عند
  تغييرها، لتجنب ظهور قيمة قديمة عند الرجوع من صفحة الأمان أو الإدارة.
- خلفية Android الأصلية وأشرطة النظام متناسقة مع Splash؛ لا تغير صلاحيات التطبيق.

Firebase:
لم تتغير ملفات Authentication أو محول Spark أو قواعد Firestore أو Cloud Functions.
لم تُنشر قواعد جديدة أو تُعدل بيانات إنتاج أو billing أو الوظائف المالية.
السكربت المرفق ينشر Hosting Preview فقط. يستخدم الحسابات والبيانات الموجودة.
ميزات 1.1.0 التي تتطلب قواعدها الجديدة تبقى معتمدة على حالة نشر تلك القواعد؛ هذه
الحزمة لا تنشرها ولا تتجاوزها.

التحقق:
26 اختبارًا ناجحًا، وصفر فشل، تشمل الاختبارات السابقة والحالات المنطقية للبداية.
TypeScript وبناء الويب وتجميع موارد Android نجحت.
اختبارات Cold/Warm/Slow/Offline المنفذة هنا محاكاة منطقية؛ ليست اختبارات جهاز.
لم تتوفر لقطات فعلية جديدة: المتصفح رفض localhost برسالة ERR_BLOCKED_BY_CLIENT.
ملف ORIN-Startup-Visual-Review.html معاينة مستقلة من مكونات React الحقيقية
للـSplash/الاتصال/الدخول/التسجيل/الاستعادة في الوضعين واللغتين. ليس Screenshots،
ولا يتصل بـFirebase. الأزرار فيه للعرض، وليست لتنفيذ التسجيل.

النشر للمعاينة فقط من هاتفك:
1. ارفع ORIN-Startup-Review.zip إلى Cloud Shell.
2. الصق عند المؤشر:
unzip -oq ORIN-Startup-Review.zip && cd ORIN-Startup-Review && bash preview.sh
3. انتظر Channel URL لقناة startup-review وأرسله للفحص. لا تستخدم Hosting URL
   بوصفه رابط التحديث. تنتهي قناة المعاينة بعد 7 أيام؛ الموقع الرئيسي لا يتغير.

قائمة القبول التي ما زالت معلقة:
- صور فعلية بعرض هاتف: البداية، الدخول، التسجيل، الاستعادة، الرئيسية، الملف،
  الإعدادات، الإشعارات، الأسواق، الحساب، ولوحة Admin بالمقاس المناسب.
- Cold Start / Warm Start على Android الحقيقي، المستخدم المسجل وغير المسجل.
- الإنترنت البطيء والانقطاع والعودة، Light/Dark/System، العربية RTL والإنجليزية LTR.
- فحص overflow، النصوص، اللمس، لوحة المفاتيح، الرجوع والوصول.
لا تعتمد APK نهائيًا قبل هذه المراجعة. APK السابق 1.1.0 لم يُستبدل ولم يُعد بناؤه.

source/ يحتوي المصدر الكامل الحالي دون مفاتيح التوقيع أو الأسرار.
لإعادة بناء الويب: npm ci ثم npm run build:firebase-spark.
هذه حزمة المصدر وليست نسخة احتياطية من بيانات Firestore الإنتاجية.
'''
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=r).decode().split('\0')
blocked={'node_modules','.git','.sites-runtime','.android-build','signing','deliverables','.openai'}
def keep(n):
 p=Path(n)
 return bool(n) and (r/p).is_file() and not set(p.parts)&blocked and p.name not in {'tsconfig.tsbuildinfo','account-test.mjs','adapter-test.mjs','startup-test.mjs','rules-extra.txt'} and not p.name.startswith('.env') and p.suffix not in {'.p12','.jks','.keystore','.log'} and 'store-password' not in n and not (p.parts[0]=='docs' and p.suffix not in {'.md','.txt'})
target=out/'ORIN-Startup-Review.zip'
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as z:
 z.writestr(prefix+'firebase.json',json.dumps(config,indent=2)+'\n');z.writestr(prefix+'preview.sh',preview);z.writestr(prefix+'README-AR.txt',readme);z.writestr(prefix+'verification.json',json.dumps(verification,ensure_ascii=False,indent=2))
 for p in sorted((r/'firebase-spark-dist').rglob('*')):
  if p.is_file():z.write(p,prefix+'public/'+p.relative_to(r/'firebase-spark-dist').as_posix())
 for n in sorted(set(files)):
  if keep(n):z.write(r/n,prefix+'source/'+n)
 z.write(out/'ORIN-Startup-Visual-Review.html',prefix+'ORIN-Startup-Visual-Review.html')
with ZipFile(target) as z:
 assert z.testzip() is None
 assert not any('/signing/' in n or n.endswith(('.p12','.jks','.apk','.keystore')) or '/node_modules/' in n for n in z.namelist())
 assert set(json.loads(z.read(prefix+'firebase.json')))=={'hosting'}
 assert 'firebase deploy' not in z.read(prefix+'preview.sh').decode()
 print(json.dumps({'file':str(target),'bytes':target.stat().st_size,'backendFilesUnchanged':len(backend),'changedExistingFiles':changed,'entries':len(z.namelist())},ensure_ascii=False))
(out/'ORIN-Startup-Verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2),encoding='utf8')

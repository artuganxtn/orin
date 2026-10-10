#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import hashlib,json,subprocess,xml.etree.ElementTree as ET
r=Path(__file__).resolve().parents[1];out=r/'deliverables';name='ORIN-Update-1.2.0';prefix=name+'/'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
with ZipFile(out/'ORIN-Backup-Before-1.2.0.zip') as z:baseline=json.loads(z.read('ORIN-Backup-Before-1.2.0/BASELINE-SHA256.json'))
protected=[n for n in baseline if (n.startswith(('firebase-spark/','firebase-functions/src/','firebase-web/')) and n.endswith(('.ts','.rules','.json'))) or n in ['firebase-app/security.tsx','lib/client-api.ts','firebase.spark.json','firebase.original.json']]
for n in protected:assert sha(r/n)==baseline[n],'Unexpected backend change: '+n
# Account form appearance changed; Authentication / Firestore submit behavior is unchanged.
with ZipFile(out/'ORIN-Backup-Before-1.2.0.zip') as z:old=z.read('ORIN-Backup-Before-1.2.0/firebase-app/account.tsx').decode()
new=(r/'firebase-app/account.tsx').read_text();start=' async function submit';end=' const strength='
assert old[old.index(start):old.index(end)]==new[new.index(start):new.index(end)]
meta=json.loads((r/'android-app/build/verification.json').read_text());assert meta['version']=='1.2.0-spark' and meta['bundledAssetsVerified'];assert sha(out/meta['file'])==meta['sha256']
assert ET.parse(r/'android-app/AndroidManifest.xml').getroot().get('{http://schemas.android.com/apk/res/android}versionCode')=='3'
log=Path('/tmp/orin-1.2-full-tests.log').read_text();assert 'tests 28' in log and 'pass 28' in log and 'fail 0' in log
assert Path('/tmp/orin-1.2-tsc-final.log').read_text()==''
verification={**meta,'tests':{'passed':28,'failed':0,'mode':'Firebase Auth/Firestore emulators + actual React SSR and startup controller tests; not an Android device test'},'typeScript':'passed','backendFilesUnchanged':protected,'authSubmitBodyUnchanged':True,'websitePublished':False,'productionRulesChanged':False,'billingChanged':False,'deviceAndVisualQA':'pending; local browser blocked and no Android device/emulator attached','referenceImage':'user-provided ORIN composition; no sample balances or profits copied'}
config={'hosting':json.loads((r/'firebase.spark.json').read_text())['hosting']};config['hosting']['public']='public'
preview='''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export FIREBASE_HOSTING_UPLOAD_CONCURRENCY=1
# Preview only. No live replacement, rules deployment, Functions or billing.
firebase hosting:channel:deploy orin-1-2-review --expires 7d --project orin-99951 --config firebase.json
'''
readme='''ORIN 1.2.0 — APK تجريبي وتحديث المرجع البصري

APK: ORIN-Android-1.2.0.apk
Android 8 أو أحدث. package: com.orin.app. versionCode: 3.
نفس مفتاح توقيع 1.0.0 و1.1.0؛ ثبّته كتحديث فوق النسخة السابقة دون حذفها.
ملفات الواجهة داخل APK، ولا يعتمد على رابط معاينة مؤقت. Firebase والأسعار يحتاجان الإنترنت.

ما تغيّر:
- يتضمن إصلاح البداية السابق: Splash أصلية مكتملة بلا Skeleton أو Header/Footer؛
  تهيئة Auth/الملف/الإعدادات/الصفحة الأولى قبل عرض الواجهة. مهلة وإعادة محاولة وOffline.
- بطاقة دخول/تسجيل/استعادة بشعار ORIN الأصلي وعمق خفيف وأيقونات الحقول وكشف كلمة المرور.
- الرئيسية: تحسين بطاقة الرصيد والاختصارات والأداء وزر ORIN المركزي؛ أرقام الحساب الفعلية فقط.
- الرصيد والأرباح الموجودة حساب محاكاة، وليست أرصدة مالية حقيقية. الحساب الجديد يبدأ بصفر.
- إصلاح زر الإيداع الذي كان يفتح السحب بسبب مقارنة النص المترجم.
- بطاقة السوق الرئيسية تعرض السعر والتغير والمنحنى والفترات من تكامل TradingView الرسمي.
- الأسواق: البحث والتصنيفات والمفضلة كما كانت، مع خيار قائمة الأسعار أو بطاقات المنحنيات.
  المنحنيات تُحمّل عند الاقتراب من منطقة العرض، دون استعلامات Firestore إضافية للأسعار.
- صفحة الأصل: ملخص السعر من المزود، الشموع والفترات والأدوات الحالية، والتكبير وإعادة العرض.
- بطاقة إشعار على الرئيسية تستخدم الإشعارات الفعلية وتفتح تفاصيلها؛ لا إشعار فرصة وهمي.
- بطاقة ORIN Bot بهوية زرقاء وعمق خفيف؛ التفعيل معطّل مع بيان واضح أنه غير متصل.
- تحسين اتجاه العربية، حقول الدخول، أحجام اللمس والألوان في Light/Dark.
- وظائف التسجيل واستعادة كلمة المرور وقواعد الأمان ومحول Spark بقيت دون تغيير منطقي.

حدود مهمة:
- النسخة ليست مطابقة حرفيًا لصورة مرسومة: صفوف الأسعار والمنحنيات وملخصات السعر تُعرض
  بأدوات المزود مع إبقاء نسبته وترخيصه. لا نقرأ الأسعار من iframe ولا نختلق High/Low/Volume.
  تنسيق صفوف مخصص مطابق للصورة وبيانات 24 ساعة مخصصة يحتاجان ربط مصدر أسعار مناسب.
- البوت، شراء/بيع فعلي، نشر/حجز/تسوية الأموال، التحويلات والإيصالات المالية الموثوقة غير مفعلة.
  واجهة الشراء/البيع معطلة على Spark حتى عند وجود دعوة مؤهلة. كود الخادم محفوظ في source/.
- الرسم المحفوظ وتنبيهات الأسعار الفعلية وPush المجدول ليست متصلة. الإشعارات داخل التطبيق تعمل
  وفق قواعد المشروع الحالية. FCM نفسه لا يعني وجوب Blaze؛ الإرسال الآلي يحتاج بيئة خادم موثوقة.
- نشر Cloud Function orinApi ضمن بنية Firebase الحالية يحتاج Blaze. لم تُنشر ولم تُنقل وظائفها
  المالية إلى العميل. العمليات المالية وإدارة Auth الحساسة وحذف البيانات المترابط تحتاج Backend.
- ميزات الصورة/إعدادات الإدارة/سجل الإدارة من 1.1 تعتمد على نشر قواعد 1.1 الموجودة في المصدر.
  هذه الحزمة لا تنشر قواعد ولا تغيّر قاعدة الإنتاج تلقائيًا. لم يمكن التحقق من حالة قواعد الإنتاج هنا.

الاختبارات:
28 اختبارًا ناجحًا وصفر فشل: التسجيل والدخول والخروج والاستعادة والتحقق، Firestore/Auth في
محاكيات معزولة، صلاحيات Admin/User، حماية الأموال، الإعدادات، الإشعارات والأرشفة، واجهات
الحساب، حالات البدء البطيء/Offline/Retry، وعدم اختلاق أرقام أو إتاحة تداول Spark.
نجح TypeScript وبناء الويب وAPK، التوقيع v2/v3 والمحاذاة وتطابق جميع 82 ملف واجهة مضمنًا.
شهادة التوقيع مطابقة للنسخة السابقة.
لم يُختبر APK على هاتف أو محاكي Android. Cold/Warm Start هنا اختبارات منطقية فقط.
المعاينة البصرية الفعلية على الجهاز واختبارات الشبكة ولوحة المفاتيح واللمس وRTL/LTR
وتحميل أدوات TradingView ما زالت مطلوبة. لا توجد screenshots جديدة معتمدة.
لا تعتمد هذه النسخة إصدارًا نهائيًا قبل تجربتها. لم يتغير رابط الموقع الحالي ولا خطة Spark.

تجربة سريعة على هاتفك:
ثبّت APK كتحديث، افتح التطبيق، سجّل الدخول أو أنشئ حساب اختبار، افحص الرئيسية والأسواق،
بدّل اللغة والمظهر، افتح الملف والإشعارات، جرّب تسجيل الخروج ثم الدخول. اختبر انقطاع الإنترنت.
إذا ظهر خطأ صلاحيات، أرسل نصه أو لقطة الشاشة دون كلمة مرور؛ لا تستخدم قواعد allow-all.

حزمة الويب والمصدر:
public/ هي نفس ملفات الواجهة الموجودة في APK.
source/ مصدر كامل دون مفاتيح توقيع أو Admin credentials؛ مع كود الوظائف المستقبلية محفوظًا.
verification.json نتائج التحقق وبصمة APK.
النسخة الاحتياطية السابقة للتعديل منفصلة: ORIN-Backup-Before-1.2.0.zip.
هذه نسخ مصدر، وليست نسخة احتياطية من بيانات Firestore الإنتاجية.

Preview اختياري على Firebase من Cloud Shell المصرّح به لديك:
cd ~ && unzip -oq ORIN-Update-1.2.0.zip && cd ORIN-Update-1.2.0 && bash preview.sh
ينشر Hosting Preview لمدة 7 أيام فقط إلى orin-99951. لا يغير الموقع الرئيسي أو القواعد أو الدفع.
لا يوجد رابط Preview جديد مؤكّد من هذه الجلسة. APK جاهز للتجربة دون رفع الحزمة.

إعادة البناء من source/:
npm ci
npm run build:firebase-spark
راجع android-app/README.md لتجهيز SDK ثم استعد مفتاح التوقيع الخاص خارج المستودع وشغّل:
python3 android-app/build.py
لا تنشئ مفتاحًا جديدًا لتحديث نسخة مثبتة.

مراجع التكامل:
https://www.tradingview.com/widget-docs/widgets/charts/symbol-overview/
https://www.tradingview.com/widget-docs/widgets/symbol-details/symbol-info/
'''
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=r).decode().split('\0')
blocked={'node_modules','.git','.sites-runtime','.android-build','signing','deliverables','.openai'}
def keep(n):
 p=Path(n)
 return bool(n) and (r/p).is_file() and not set(p.parts)&blocked and p.name!='tsconfig.tsbuildinfo' and not p.name.endswith('-test.mjs') and not p.name.startswith('.env') and p.suffix not in {'.p12','.jks','.keystore','.log'} and 'store-password' not in n and not (p.parts[0]=='docs' and p.suffix not in {'.md','.txt'})
target=out/(name+'.zip')
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as z:
 z.writestr(prefix+'firebase.json',json.dumps(config,indent=2)+'\n');z.writestr(prefix+'preview.sh',preview);z.writestr(prefix+'README-AR.txt',readme);z.writestr(prefix+'verification.json',json.dumps(verification,ensure_ascii=False,indent=2))
 for p in sorted((r/'firebase-spark-dist').rglob('*')):
  if p.is_file():z.write(p,prefix+'public/'+p.relative_to(r/'firebase-spark-dist').as_posix())
 for n in sorted(set(files)):
  if keep(n):z.write(r/n,prefix+'source/'+n)
with ZipFile(target) as z:
 assert z.testzip() is None
 assert not any('/signing/' in n or n.endswith(('.p12','.jks','.apk','.keystore')) or '/node_modules/' in n for n in z.namelist())
 assert set(json.loads(z.read(prefix+'firebase.json')))=={'hosting'}
 assert 'firebase deploy' not in z.read(prefix+'preview.sh').decode()
 print(json.dumps({'file':str(target),'bytes':target.stat().st_size,'protectedBackendFiles':len(protected),'entries':len(z.namelist()),'tests':28}))

#!/usr/bin/env python3
"""Package the reviewed Spark build, source backup and preview-only instructions."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, html, json, subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'deliverables'
OUT.mkdir(exist_ok=True)
NAME = 'ORIN-Update-1.1.0'
META = json.loads((ROOT / 'android-app/build/verification.json').read_text())
assert META['version'] == '1.1.0-spark' and META['bundledAssetsVerified']
assert hashlib.sha256((OUT / META['file']).read_bytes()).hexdigest() == META['sha256']

preview = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export FIREBASE_HOSTING_UPLOAD_CONCURRENCY=1
# Additive rules are shared by live/preview clients; Hosting live is untouched.
firebase deploy --project orin-99951 --only firestore:rules
firebase hosting:channel:deploy orin-1-1-review --expires 7d --project orin-99951
'''
readme = '''ORIN 1.1.0 — تحديث الواجهة الأصلية على Firebase Spark

حزمة Source Code كاملة + ملفات واجهة مبنية وجاهزة للمعاينة.
المشروع: orin-99951. لا Billing ولا Blaze ولا نشر Cloud Functions.
الموقع الرئيسي لم يتغير. ملف APK يُسلّم بصورة منفصلة.

من هاتفك، ارفع ORIN-Update-1.1.0.zip إلى Cloud Shell، ثم الصق:
unzip -oq ORIN-Update-1.1.0.zip && cd ORIN-Update-1.1.0 && bash preview.sh

انتظر Deploy complete وانسخ Channel URL الجديد. لا تستخدم Hosting URL للحكم
على هذا التحديث: Hosting URL يشير للموقع الرئيسي القديم. قناة التحديث الجديدة
اسمها orin-1-1-review وتنتهي بعد 7 أيام، ولا يستبدل السكربت قناة المعاينة السابقة.

السكربت ينشر قواعد Firestore الإضافية المختبرة إلى قاعدة البيانات المشتركة، ثم
ينشر واجهة المعاينة. يحتاج رفع الصورة وطلب الحذف والسجل والإعدادات الجديدة إلى
هذه القواعد. لا يحذف السكربت بيانات. لا يحتوي على أمر نشر الموقع الرئيسي.
المعاينة وAPK والموقع يستخدمون الحسابات والبيانات الحقيقية نفسها؛ استخدم حساب
اختبار ولا ترسل حملة تجريبية إلى العملاء.

قبل اعتماد النسخة:
1. إنشاء حساب، تحقق البريد، خروج ودخول، واستعادة كلمة المرور.
2. تعديل الاسم والصورة، وحفظ إعدادات Light/Dark/System والعربية/الإنجليزية.
3. إغلاق APK وإعادة فتحه، الرجوع، لوحة المفاتيح، انقطاع الشبكة وعودتها.
4. رفض /admin للمستخدم العادي؛ اختبار المالك المؤكد البريد وإدارة مستخدم تجريبي.
5. إشعار داخلي: قراءة/أرشفة/استعادة. جرّب تصدير بياناتك إلى ملف.
6. راجع الشكل والنصوص والشارت على هاتفك؛ لا تزال المعاينة البصرية الشاملة معلقة.

إذا كان APK 1.0.0 مثبتًا، ثبّت 1.1.0 كتحديث دون حذف التطبيق القديم.
Android 8 أو أحدث. package ID: com.orin.app، versionCode: 2.
الواجهة مضمنة داخل APK ولا تعتمد على رابط المعاينة. خدمات Firebase تحتاج الإنترنت.
تعليق حساب من ORIN يمنع الوصول إلى بيانات التطبيق؛ لا يحذف هوية Firebase Auth.
طلب الحذف يُرسل للمراجعة ولا ينفذ حذفًا شاملًا تلقائيًا.

المحتويات:
public/             الملفات المبنية الجاهزة للمعاينة، مطابقة لما داخل APK.
source/             المصدر الحالي الكامل، مع Android وCloud Functions المحفوظة.
rollback/           نسخة قواعد ما قبل التحديث للمرجع، وليست أمر استرجاع تلقائيًا.
verification.json   بصمة APK ونتائج تحقق التوقيع/الملفات.
ORIN-Update-1.1.0-Report.html   ما اكتمل وحدود التحديث والاختبارات.

إعادة البناء للمبرمج من source/:
npm ci
npm run build:firebase-spark
npx tsc --noEmit
راجع android-app/README.md لبناء APK. استعد مفتاح التوقيع الخاص السابق قبل أي
إصدار جديد؛ المفتاح وكلمة مروره غير موجودين في هذا المصدر أو في APK.
ملفات firebase.original.json وأكواد Cloud Functions محفوظة فقط، ولا تنشرها على Spark.
نفّذ الاختبارات على مشروع محاكي demo-orin-auth، وليس المشروع الحقيقي.
'''

report = '''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ORIN 1.1.0 — تقرير التحديث</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f6fb;color:#17273a;font:17px/1.85 system-ui,Arial,sans-serif}main{max-width:1000px;margin:auto;padding:28px 20px}header{padding:30px;border-radius:24px;background:#06111f;color:#f5f9ff;border-bottom:4px solid #0788ff}h1{margin:0;font-size:30px}h2{color:#075db4;font-size:22px;margin-top:30px}.tag{color:#8adeff}.notice,section{background:white;padding:22px;border-radius:18px;margin-top:20px}.notice{border-right:5px solid #d99814}table{border-collapse:collapse;width:100%;font-size:15px}td,th{text-align:right;padding:12px;border-bottom:1px solid #dce5ef;vertical-align:top}th{background:#edf4fc}code,pre{direction:ltr;unicode-bidi:embed;font:13px/1.7 monospace;overflow-wrap:anywhere}pre{background:#06111f;color:white;padding:18px;border-radius:12px;white-space:pre-wrap;text-align:left}a{color:#075db4}li{margin:7px 0}.scroll{overflow:auto}.muted{color:#506176}@media(max-width:600px){main{padding:12px}header,section{padding:18px}h1{font-size:25px}td,th{padding:8px;min-width:110px}}@media print{body{background:white}header{background:#edf4fc;color:#17273a}section{padding:0}a{color:inherit}tr{break-inside:avoid}}
</style><main><header><div class="tag">ORIN · 1.1.0-spark · 3 أكتوبر 2026</div><h1>تقرير التحديث التجريبي</h1><p>الواجهة الأصلية + Firebase Spark + APK بملفات مضمنة. لم يُستبدل الموقع الرئيسي ولم تتغير خطة الدفع.</p></header>
<div class="notice"><strong>حالة التسليم:</strong> البناء وAPK والاختبارات الآلية جاهزة. التحديث 1.1.0 لم يُنشر بعد؛ أداة النشر غير مسجلة الدخول وCloud Shell في جلسة المتصفح يعرض Site Unavailable. لا يوجد رابط Preview جديد يمكن تأكيده الآن. النشر متاح بالسكربت المرفق من Cloud Shell على هاتف المالك.</div>
<section><h2>ما تغيّر</h2><div class="scroll"><table><thead><tr><th>المجال</th><th>التنفيذ في 1.1.0</th><th>الحدود</th></tr></thead><tbody>
<tr><td>الهوية والمظهر</td><td>الواجهة والشعار الأصليان محفوظان؛ طبقة إضافية للعمق والظلال والحالات، Light/Dark/System، RTL/LTR وتخفيف الحركة.</td><td>لا مكتبة 3D ثقيلة. لم يكتمل فحص بصري لكل الصفحات على جهاز حقيقي.</td></tr>
<tr><td>الحساب والأمان</td><td>تحقق مدخلات، إظهار كلمة المرور وقوتها، منع تكرار الإرسال، رسائل مفهومة، التحقق من البريد وتغيير كلمة المرور بعد إعادة المصادقة.</td><td>رسائل التحقق والاستعادة ترجع إلى نطاق المشروع الثابت. الاختبار الحقيقي لاستلام البريد ما زال مطلوبًا.</td></tr>
<tr><td>الملف والبيانات</td><td>صورة خاصة مصغرة 192×192، الاسم والحقول المسموحة، تاريخ الإنشاء، إخفاء UID، تصدير بيانات الحساب، طلب حذف مؤكد.</td><td>طلب الحذف لا يمحو الحساب تلقائيًا. الصورة صغيرة في مستند خاص؛ لا رفع ملفات عام أو Cloud Storage.</td></tr>
<tr><td>الإعدادات والقانونية</td><td>أقسام الحساب والأمان والمظهر واللغة والإشعارات والبيانات والمساعدة والخصوصية والشروط، تسجيل الخروج وإصدار التطبيق.</td><td>بريد الدعم يحتاج أن يضبطه المالك. نظام تذاكر الدعم الكامل غير موصول.</td></tr>
<tr><td>الإدارة</td><td>Dashboard متجاوب، إحصاءات من المستندات الفعلية، بحث وفلاتر، صلاحيات وحالة المستخدم مع تأكيد، إعداد المحتوى والصيانة وطلبات الحذف.</td><td>الإحصاءات على السجلات المحملة، حتى 1000 مستخدم مع تنبيه عند بلوغ الحد. شاشة العقود الأصلية محفوظة في /admin/contracts.</td></tr>
<tr><td>قواعد الأمان والتدقيق</td><td>منع وصول مستخدم لبيانات غيره ومنع تعديل الأرصدة، قواعد الصورة والطلبات والإعدادات. تعديل المستخدم وسجل الإدارة في معاملة واحدة.</td><td>السجل يغطي تعديلات لوحة الإدارة الجديدة، وليس كل تغيير من لوحة Firebase أو عميل قديم. الصيانة حالة عرض وليست قفلًا لخادم البيانات.</td></tr>
<tr><td>الإشعارات</td><td>الحالات والعداد والروابط الداخلية محفوظة، مع أرشفة واستعادة خاصة بالمستخدم، وإعلانات داخل التطبيق بمعاينة وتأكيد.</td><td>لا Push أو إرسال تلقائي مجدول. الحد الحالي للحملة 200 مستلم مع فحص حتى 1000 حساب.</td></tr>
<tr><td>الاستقرار والأداء</td><td>Skeleton، Offline وإعادة المحاولة، مهلة قراءة، Error Boundary، تحميل أجزاء عند الحاجة، تخزين مؤقت وتقليل الاستعلامات في الخلفية.</td><td>تحذير بناء غير حاجب: الحزمة الأساسية قرابة 814KB قبل gzip. لم يُقَس الأداء على هاتف ضعيف.</td></tr>
<tr><td>Android</td><td>APK ثابت الحزمة وموقّع، الواجهة داخله، رجوع وSafe Areas وIME، اختيار صورة وحفظ ملف عبر النظام، Splash حديث.</td><td>لم يُشغّل على هاتف أو محاكي Android. ليس نشرًا في متجر Play.</td></tr>
</tbody></table></div></section>
<section><h2>الأمان والوظائف المعلّقة</h2><p>لم تُنقل العمليات المالية إلى المتصفح أو APK. كود الخادم الأصلي محفوظ في <code>source/firebase-functions/</code>. الدالة المنشورة الوحيدة في ذلك الكود هي <code>orinApi</code>؛ نشرها في Firebase يتطلب Blaze. نشر هذه الحزمة لا يستدعيها.</p><div class="scroll"><table><tr><th>الوظيفة</th><th>الحالة والسبب</th></tr>
<tr><td><code>bootstrap / journal / audit</code> المالي</td><td>لا تمويل ابتدائي أو أرصدة وهمية أو قيود مالية من العميل؛ يلزم خادم موثوق. الحساب الجديد دون بيانات مالية يبدأ بصفر.</td></tr>
<tr><td><code>publish / join / settle</code></td><td>نشر العقود المقفلة وحجز الأموال والمشاركة والتسوية والأرباح والخسائر والإيصالات وإشعارات التسوية معطّلة بوضوح. السجلات السابقة للقراءة فقط.</td></tr>
<tr><td>التحويلات والإيداع والسحب الحقيقي</td><td>لا مزود دفع أو Backend مالي موثوق متصل. لم تُضف عمليات مالية حقيقية.</td></tr>
<tr><td>Push والجدولة التلقائية</td><td>غير موصولة. FCM نفسها ليست سببًا لازمًا للترقية؛ ينقص دمج العميل والأذونات ومرسل موثوق. استخدام Cloud Functions للإرسال/الجدولة يحتاج Blaze.</td></tr>
<tr><td>حذف شامل / إلغاء كل الجلسات</td><td>يلزم تنفيذ إداري موثوق لتنسيق Auth والبيانات. المتاح الآن طلب حذف للمراجعة؛ لا ادعاء بمحو فوري أو إلغاء جميع الرموز.</td></tr>
<tr><td>ميزات إضافية غير مكتملة</td><td>MFA/Passkeys/بصمة وأجهزة موثوقة، تذاكر الدعم، مكافآت الإحالة والوكيل وتنبيهات الأسعار غير موصولة بالكامل. ليست كلها محجوبة بسبب Blaze؛ بعضها يحتاج تطويرًا وربطًا إضافيين.</td></tr></table></div><p>تسجيل الحساب والدخول والخروج واستعادة كلمة المرور والملف والتفضيلات والإدارة والإشعارات الداخلية تعمل ببنية Authentication + Firestore Rules دون نشر Functions، ضمن حدود Spark. لم تُضف Analytics أو متتبعات إعلانية.</p></section>
<section><h2>ما اختُبر فعليًا</h2><p><strong>16 اختبارًا ناجحًا، صفر فشل</strong> في محاكيات Firebase المعزولة وNode. نجح TypeScript وبناء الإنتاج، وفحص توقيع APK ومحاذاته وسلامة الأرشيف ومطابقة 82 ملف واجهة مع البناء.</p><ul><li>التسجيل والدخول والخروج والاستعادة وتغيير كلمة المرور والتحقق من البريد في محاكي Auth.</li><li>ملكية البيانات، أدوار الإدارة، الحساب الموقوف، منع الكتابة المالية، التفضيلات وتعارض المراجعات، نشر الإعلان الذري والأرشفة.</li><li>خصوصية الصورة وحدودها، الطلب غير القابل للتلاعب، صلاحيات إعداد المحتوى وسجل الإدارة الذري.</li><li>Validation والمسارات الآمنة، HTML نماذج الدخول بالعربية والإنجليزية، وثبات ملفات الهوية الأساسية وتباين ألوان محددة.</li></ul><p><strong>لم يُختبر بعد:</strong> المسار الكامل على Firebase الحقيقي، جميع صفحات/أزرار التطبيق بصريًا، إعادة فتح APK وحفظ الجلسة على الهاتف، دوران الشاشة ولوحة المفاتيح واختيار الصور/التصدير وOffline/Online على جهاز، الأداء الفعلي وقارئ الشاشة. ثبات ملفات CSS الأساسية ليس اختبار لقطات بصريًا شاملًا للطبقة الجديدة.</p><p>لم تُزرع حسابات اختبار في قاعدة البيانات الفعلية ولم تُحذف بيانات إنتاج.</p></section>
<section><h2>نشر Preview من هاتفك</h2><p>ارفع <code>ORIN-Update-1.1.0.zip</code> عبر Upload في Cloud Shell، ثم الصق السطر التالي عند المؤشر بعد علامة الدولار واضغط Enter:</p><pre>unzip -oq ORIN-Update-1.1.0.zip &amp;&amp; cd ORIN-Update-1.1.0 &amp;&amp; bash preview.sh</pre><p>انتظر رابط <strong>Channel URL</strong> لقناة <code>orin-1-1-review</code>. ليس رابط Hosting URL القديم. رابط المعاينة لمدة 7 أيام؛ APK لا يعتمد عليه. السكربت يحدّث قواعد Firestore الإضافية أولًا؛ قاعدة البيانات مشتركة، لذا اختبر بحساب مخصص. لا يغيّر السكربت الموقع الرئيسي ولا ينشر Cloud Functions.</p><p>القواعد الجديدة مطلوبة للصورة والطلبات وإعدادات الإدارة والسجل. بعد اختبار المعاينة وAPK وموافقتك فقط يمكن اعتماد نفس الإصدار على الرابط الرئيسي. لا يوجد في الحزمة أمر تلقائي لنشر live.</p></section>
<section><h2>APK والنسخ الاحتياطية</h2><p><strong>ORIN-Android-1.1.0.apk</strong> — Android 8+، حزمة <code>com.orin.app</code>، versionCode <code>2</code>، الحجم <strong>3.44 MB</strong>. نفس مفتاح إصدار 1.0.0؛ ثبّته كتحديث دون إزالة الإصدار السابق.</p><details><summary>بصمة SHA-256</summary><code>APK_SHA_PLACEHOLDER</code></details><p><code>ORIN-Source-Before-1.1.0.zip</code> نسخة المصدر قبل التعديل. مجلد <code>source/</code> في حزمة التحديث هو المصدر الحالي الكامل. هذه نسخ كود، وليست نسخة احتياطية من بيانات Firestore الإنتاجية. ملف المفتاح الخاص محفوظ منفصلًا من التسليم السابق ولا يظهر في هذا المصدر أو APK.</p></section>
<section><h2>مراجع البنية</h2><p class="muted">تحقق 3 أكتوبر 2026: <a href="https://firebase.google.com/docs/functions/get-started">متطلبات نشر Cloud Functions</a> · <a href="https://firebase.google.com/docs/projects/billing/firebase-pricing-plans">خطط Firebase</a> · <a href="https://firebase.google.com/docs/cloud-messaging/server-environment">المرسل الموثوق لـFCM</a>. حالة تنفيذ ORIN أعلاه مستمدة من الكود والاختبارات المحلية، وليست ضمانًا بوصول الميزات غير المختبرة إلى الإنتاج.</p></section></main></html>'''.replace('APK_SHA_PLACEHOLDER', html.escape(META['sha256']))
report_path = OUT / (NAME + '-Report.html')
report_path.write_text(report, encoding='utf-8')

config = json.loads((ROOT / 'firebase.spark.json').read_text())
config['hosting']['public'] = 'public'
config['firestore'] = {'rules':'firestore.rules','indexes':'firestore.indexes.json'}
config.pop('emulators',None)
assert 'functions' not in config and not any('function' in r for r in config['hosting']['rewrites'])
source_files = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
blocked_parts = {'node_modules','.git','.sites-runtime','.android-build','signing','deliverables','.openai'}
def allowed(name):
    p=Path(name)
    return bool(name) and (ROOT/p).is_file() and not set(p.parts)&blocked_parts and p.name not in {'tsconfig.tsbuildinfo','account-test.mjs','adapter-test.mjs','rules-extra.txt'} and not p.name.startswith('.env') and not p.name.endswith(('.p12','.jks','.keystore','.log')) and 'store-password' not in p.name and not (p.parts[0]=='docs' and p.suffix not in {'.md','.txt'})

target = OUT / (NAME + '.zip')
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as z:
    prefix=NAME+'/'
    z.writestr(prefix+'firebase.json',json.dumps(config,indent=2)+'\n')
    z.writestr(prefix+'preview.sh',preview)
    z.writestr(prefix+'README-AR.txt',readme)
    z.writestr(prefix+'verification.json',json.dumps(META,indent=2)+'\n')
    z.write(report_path,prefix+report_path.name)
    z.write(ROOT/'firebase-spark/firestore.rules',prefix+'firestore.rules')
    z.write(ROOT/'firebase-web/firestore.indexes.json',prefix+'firestore.indexes.json')
    for p in sorted((ROOT/'firebase-spark-dist').rglob('*')):
        if p.is_file(): z.write(p,prefix+'public/'+p.relative_to(ROOT/'firebase-spark-dist').as_posix())
    for name in sorted(set(source_files)):
        if allowed(name): z.write(ROOT/name,prefix+'source/'+name)
    with ZipFile(OUT/'ORIN-Source-Before-1.1.0.zip') as prior:
        candidates=[n for n in prior.namelist() if n.endswith('firebase-spark/firestore.rules')]
        assert len(candidates)==1,candidates
        z.writestr(prefix+'rollback/firestore-1.0.rules',prior.read(candidates[0]))
with ZipFile(target) as z:
    assert z.testzip() is None
    names=z.namelist()
    assert len(names)==len(set(names))
    for needed in ['public/index.html','source/firebase-spark/experience.ts','source/android-app/src/com/orin/app/MainActivity.java','source/firebase-functions/src/index.ts','source/package-lock.json']:
        assert prefix+needed in names,needed
    assert not any(set(Path(n).parts)&blocked_parts or '/.env' in n or n.endswith(('.p12','.jks','.apk','.keystore')) or 'store-password' in n for n in names)
    assert prefix+'publish.sh' not in names
    assert z.read(prefix+'public/index.html')==(ROOT/'firebase-spark-dist/index.html').read_bytes()
    assert 'orin-1-1-review' in z.read(prefix+'preview.sh').decode()
    print(json.dumps({'file':str(target),'bytes':target.stat().st_size,'entries':len(names),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'report':str(report_path)},ensure_ascii=False))

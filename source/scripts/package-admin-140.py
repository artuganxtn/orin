"""Package the current ORIN review source without private signing material."""
from pathlib import Path
import hashlib, json, re, zipfile, io

root = Path(__file__).resolve().parents[1]
base = root.parent
out = base / 'deliverables'
original = base.parents[0] / 'orin-latest/ORIN-Control-Center-Review-Package.zip'
if not original.is_file():
    raise SystemExit('Keep the unchanged previous Control Center review package beside this worktree under orin-latest/.')

def counts(name):
    text = (base / name).read_text()
    passed = [int(n) for n in re.findall(r'ℹ pass (\d+)', text)]
    failed = [int(n) for n in re.findall(r'ℹ fail (\d+)', text)]
    if not passed or not failed or any(failed): raise RuntimeError('Missing or failing test result: ' + name)
    return sum(passed)

tests = {'control': counts('control-v2-tests.log'), 'regression': counts('control-v2-regression.log'), 'production_rules_candidate': counts('control-v2-production-rules.log')}
tests['total'] = sum(tests.values())
assert tests == {'control': 44, 'regression': 51, 'production_rules_candidate': 4, 'total': 99}
assert not (base / 'control-v2-typecheck.log').read_text().strip()
assert '✓ built' in (base / 'control-v2-web-build.log').read_text()
assert (root / 'firebase-functions/lib/index.js').is_file()
assert 'Install the pinned official Android SDK' in (base / 'control-v2-android-build.log').read_text()

exclude = {'node_modules', '.git', '.next', '.wrangler', '.android-build', 'dist', 'firebase-spark-dist', 'firebase-app-dist', 'firebase-dist', 'deliverables', 'signing', '__pycache__', '.cache'}
generated = {'adapter-test.mjs', 'reference-test.mjs', 'reference-test.css', 'program-test.mjs', 'control-test.mjs', 'control-ui-bundle.mjs', 'release-130-bundle.mjs', 'market-data-test.mjs', 'startup-test.mjs'}
files = []
for p in root.rglob('*'):
    rel = p.relative_to(root)
    if p.is_symlink() or not p.is_file() or any(part in exclude for part in rel.parts): continue
    if rel.parts[:2] in [('android-app', 'build'), ('firebase-functions', 'lib')]: continue
    if p.name.startswith('.env') or p.name in generated or p.suffix.lower() in {'.p12', '.jks', '.keystore', '.pem', '.key', '.log', '.map', '.tsbuildinfo', '.pyc'}: continue
    if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', p.read_bytes()): raise RuntimeError('Private key material in source')
    files.append(p)
with zipfile.ZipFile(original) as z:
    known = {n[7:]: hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('source/') and not n.endswith('/')}
manifest = [{'path': p.relative_to(root).as_posix(), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(files)]
changes = [{**m, 'change': 'modified' if m['path'] in known else 'added'} for m in manifest if known.get(m['path']) != m['sha256']]
assert not any(m['path'].startswith(('app/', 'public/')) for m in changes)
verification = {'date': '2026-10-04', 'version': '1.4.0-preview', 'intended_version_code': 7, 'project': 'existing ORIN', 'modules': 22, 'roles': 8, 'permissions': 31, 'tests': tests, 'failed': 0, 'typecheck': 'passed', 'web_build': 'passed', 'server_build': 'passed', 'original_customer_app_and_assets': 'unchanged', 'new_apk_built': False, 'apk_blocker': 'Official pinned Android SDK unavailable; network connection to SDK host timed out.', 'original_signing_certificate_verified': True, 'signing_material_in_deliverables': False, 'production_deployment': False, 'production_writes': False, 'billing_change': False, 'browser_visual_test': False, 'physical_android_test': False, 'real_provider_test': False, 'preview': 'actual component, editable illustrative in-memory ticket fixtures, network denied', 'prior_package_sha256': hashlib.sha256(original.read_bytes()).hexdigest(), 'changed_source_files': len(changes), 'source_files': manifest}
(out / 'ORIN-Admin-1.4.0-Verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n')
(out / 'ORIN-Admin-1.4.0-Changed-Files.json').write_text(json.dumps(changes, ensure_ascii=False, indent=2) + '\n')

report = '''ORIN — تحديث الإدارة 1.4.0 للمراجعة
4 أكتوبر 2026

تم تطوير مركز الإدارة الحالي مع الحفاظ على واجهة العميل وشعار ORIN والشارت. أصبح المركز يضم 22 قسمًا، و8 أدوار، و31 صلاحية.

الميزات الجديدة
1. مركز دعم داخلي: إنشاء تذاكر مرتبطة بالمستخدم، تصنيف الطلب، أربع أولويات، موعد متابعة اختياري، وخمس حالات من الفتح إلى الحل والإغلاق، مع إمكانية إعادة الفتح.
2. توزيع العمل: استلام الموظف للتذاكر غير المسندة، إلغاء إسناده، وإسناد المشرف للتذكرة إلى موظف دعم نشط. لا يستطيع الموظف الاستيلاء على تذكرة موظف آخر.
3. ملاحظات داخلية محفوظة باسم الموظف ووقت الإضافة. لا يوجد تعديل أو حذف للملاحظات، وإعادة الطلب لا تنشئ نسخة مكررة. لا تُرسل الملاحظات إلى العملاء.
4. قائمة متابعة في الرئيسية: التذاكر المفتوحة، تذاكري، التذاكر المتأخرة، وطلبات الهوية والموافقات والسحب ضمن صلاحية الموظف. روابط البطاقات تفتح القسم؛ بطاقة التأخير تعرض العدد ويظهر وسم التأخير بجانب التذاكر.
5. سجل تدقيق ببحث على الخادم حسب التاريخ والموظف والعملية والهدف، الأحدث أولًا، مع تنقل بين الصفحات وتصدير الصفحة المطابقة للفلاتر.
6. فلاتر تذاكر حسب الحالة والأولوية والمسؤول، وزر العودة للصفحة السابقة. بحث النص في غير قائمة المستخدمين يظل ضمن الصفحة المعروضة، كما توضحه الواجهة.

المعاينة
افتح ORIN-Admin-1.4.0-Preview.html ثم اختر «مركز الدعم». تستطيع إنشاء تذكرة باستخدام review-user أو review-sara، وإضافة ملاحظة وتغيير الحالة والأولوية. الموظف التوضيحي review-support، والمشرف review-operations. بدّل الدور في أعلى المعاينة لمراجعة الصلاحيات. البيانات أمثلة فقط، والتغييرات تحفظ في ذاكرة المعاينة وتزول عند إعادة تحميلها. لا يوجد اتصال بالإنتاج أو إرسال رسائل.

التحقق
نجحت 99 نتيجة اختبار آلي: 44 للإدارة والصلاحيات والتذاكر والواجهة والقواعد؛ 51 للميزات السابقة؛ و4 لقواعد الانتقال المرشحة. نجح TypeScript وبناء الويب والخادم. مرفق المصدر الكامل ونتائج الاختبارات وبناء الويب والخادم ومصفوفة الصلاحيات والنسخة السابقة للمراجعة والاستعادة.

حالة التشغيل وAndroid
هذا تحديث مصدر ومعاينة، وليس تفعيلًا للإدارة على الإنتاج. يلزم تجهيز Backend موثوق، وتجربة القواعد والفهارس الجديدة وحسابات الموظفين في بيئة اختبار قبل اعتماد التشغيل. لم يتغير الموقع المنشور أو الفوترة أو القواعد أو بيانات العملاء أو الأموال، ولم يُنشأ مدير إنتاجي أو تُرسل إشعارات.
استُعيد مفتاح التوقيع الأصلي وتحققت مطابقة شهادته. تعذر بناء APK لأن Android SDK غير متوفر وتعذر تنزيله؛ لا يوجد APK جديد لهذا التحديث. رقم المصدر المقترح 1.4.0-preview ورقم البناء 7. APK القديم 1.3.1 لا يحتوي هذه الإضافات. مفاتيح التوقيع وكلمات المرور غير موجودة بالحزمة.
لم يُجرَ اختبار بصري حي في المتصفح أو على هاتف فعلي، ولا اختبار مزوّد دفع أو تداول حقيقي. تعليمات التفعيل والقيود موجودة في source/ORIN-ADMIN-1.4.0-NOTES.md.
'''
(out / 'ORIN-Admin-1.4.0-Review-Report.txt').write_text(report)
name = out / 'ORIN-Admin-1.4.0-Review-Package.zip'
with zipfile.ZipFile(name, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in files: z.write(p, 'source/' + p.relative_to(root).as_posix())
    for directory, prefix in [(root / 'firebase-spark-dist', 'web-build'), (root / 'firebase-functions/lib', 'server-build')]:
        for p in directory.rglob('*'):
            if p.is_file() and p.suffix != '.map': z.write(p, prefix + '/' + p.relative_to(directory).as_posix())
    for suffix in ['Preview.html', 'Permissions.html', 'Review-Report.txt', 'Changed-Files.json', 'Verification.json']:
        p = out / ('ORIN-Admin-1.4.0-' + suffix); z.write(p, p.name)
    z.write(out / 'ORIN-Resume.txt', 'ORIN-Resume.txt')
    z.write(original, 'backup/' + original.name)
    for p in sorted(base.glob('control-v2-*.log')): z.write(p, 'verification/' + p.name)

def inspect_archive(z):
    assert z.testzip() is None
    for info in z.infolist():
        assert not any(x in Path(info.filename).parts for x in ['signing', 'node_modules'])
        assert Path(info.filename).suffix.lower() not in {'.p12', '.jks', '.keystore', '.pem', '.key'}
        if info.filename.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(z.read(info))) as nested: inspect_archive(nested)
with zipfile.ZipFile(name) as z: inspect_archive(z)
print(json.dumps({'package': str(name), 'bytes': name.stat().st_size, 'source_files': len(files), 'changed_files': len(changes), 'tests': tests, 'sha256': hashlib.sha256(name.read_bytes()).hexdigest()}))

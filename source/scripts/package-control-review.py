from pathlib import Path
import zipfile, hashlib, json, re
root=Path(__file__).resolve().parents[1]
base=root.parent
out=base/'deliverables'
backup=out/'ORIN-Backup-1.3.1-Before-Control-Center.zip'
exclude={'node_modules','.git','.next','.wrangler','.android-build','build','dist','firebase-spark-dist','firebase-app-dist','firebase-dist','deliverables','signing','__pycache__','.cache'}
files=[]
for p in root.rglob('*'):
    rel=p.relative_to(root)
    if p.is_symlink() or not p.is_file() or any(x in exclude for x in rel.parts):continue
    if rel.parts[:2]==('firebase-functions','lib'):continue
    if p.name.startswith('.env') or p.suffix.lower() in {'.p12','.jks','.keystore','.pem','.key','.log','.map','.tsbuildinfo','.pyc'}:continue
    if p.name in {'adapter-test.mjs','reference-test.mjs','reference-test.css','program-test.mjs','control-test.mjs','control-ui-bundle.mjs','release-130-bundle.mjs','market-data-test.mjs','startup-test.mjs'}:continue
    if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',p.read_text(errors='ignore')):raise SystemExit('Private key material detected in '+str(rel))
    files.append(p)
with zipfile.ZipFile(backup) as original:
    known={x.filename:hashlib.sha256(original.read(x)).hexdigest() for x in original.infolist() if not x.is_dir()}
changes=[]
for p in files:
    rel=p.relative_to(root).as_posix();digest=hashlib.sha256(p.read_bytes()).hexdigest()
    if known.get(rel)!=digest:changes.append({'path':rel,'change':'modified' if rel in known else 'added','sha256':digest})
(out/'ORIN-Control-Center-Changed-Files.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2))
verification={'date':'2026-10-04','project':'ORIN existing source','tests':{'control_center':29,'existing_regression':51,'production_rules_candidate':3,'total':83,'failed':0},'typecheck':'passed','web_build':'passed','functions_build':'passed','production_deployment':False,'production_super_admin_created':False,'new_apk_built':False,'browser_visual_test':False,'physical_android_test':False,'preview':'isolated illustrative fixtures, no network','backup_sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'changed_source_files':len(changes)}
(out/'ORIN-Control-Center-Verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2))
name=out/'ORIN-Control-Center-Review-Package.zip'
with zipfile.ZipFile(name,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files:z.write(p,'source/'+p.relative_to(root).as_posix())
    for p in (root/'firebase-spark-dist').rglob('*'):
        if p.is_file():z.write(p,'web-build/'+p.relative_to(root/'firebase-spark-dist').as_posix())
    for p in (root/'firebase-functions/lib').rglob('*'):
        if p.is_file() and p.suffix!='.map':z.write(p,'server-build/'+p.relative_to(root/'firebase-functions/lib').as_posix())
    for fname in ['ORIN-Control-Center-Preview.html','ORIN-Control-Center-Permissions.html','ORIN-Control-Center-Review-Report.txt','ORIN-Control-Center-Changed-Files.json','ORIN-Control-Center-Verification.json']:z.write(out/fname,fname)
    z.write(backup,'backup/'+backup.name)
    for fname in ['orin-control-tests.log','orin-control-regression.log','orin-control-production-rules-tests.log','orin-control-build.log','orin-control-server-build.log']:z.write(base/fname,'verification/'+fname)
with zipfile.ZipFile(name) as z:
    assert z.testzip() is None
    assert not any('/signing/' in n or '/node_modules/' in n for n in z.namelist())
print(json.dumps({'package':str(name),'bytes':name.stat().st_size,'source_files':len(files),'changed':len(changes),'sha256':hashlib.sha256(name.read_bytes()).hexdigest()}))

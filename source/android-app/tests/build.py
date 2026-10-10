from pathlib import Path
import argparse
parser=argparse.ArgumentParser();parser.add_argument("--target-package",choices=["com.orin.qa","com.orin.app"],default="com.orin.qa");args=parser.parse_args()
import subprocess,zipfile,shutil
root=Path(__file__).resolve().parents[2];test=root/'android-app/tests';out=test/'build';out.mkdir(exist_ok=True);tools=root/'.android-build/tools/android-15';platform=root/'.android-build/platform/android-35/android.jar'
manifest=out/'AndroidManifest.xml';manifest.write_text((test/'AndroidManifest.xml').read_text().replace('android:targetPackage="com.orin.qa"','android:targetPackage="'+args.target_package+'"'))
def run(*cmd):subprocess.run([str(x) for x in cmd],check=True)
run(tools/'aapt2','link','-o',out/'unsigned.apk','--manifest',manifest,'-I',platform,'-A',test/'assets')
classes=out/'classes';shutil.rmtree(classes,ignore_errors=True);classes.mkdir()
run('java','-m','jdk.compiler/com.sun.tools.javac.Main','--release','8','-encoding','UTF-8','-classpath',platform,'-d',classes,*test.glob('src/**/*.java'))
dex=out/'dex';dex.mkdir(exist_ok=True);run('java','-cp',tools/'lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',platform,'--output',dex,*classes.rglob('*.class'))
with zipfile.ZipFile(out/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:z.write(dex/'classes.dex','classes.dex')
run(tools/'zipalign','-f','4',out/'unsigned.apk',out/'aligned.apk')
run('java','-jar',tools/'lib/apksigner.jar','sign','--ks',root/'android-app/signing/orin-release.p12','--ks-key-alias','orin','--ks-pass','file:'+str(root/'android-app/signing/store-password.txt'),'--out',out/'ORIN-QA-Runner.apk',out/'aligned.apk')

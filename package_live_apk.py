import os
import shutil
import zipfile
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
DIST = SOURCE / "firebase-security-dist"
BASE_APK = ROOT / "ORIN-Android-1.6.2-Review.apk"
KEYSTORE = SOURCE / "android-app/orin-release.jks"
OUTPUT_APK = ROOT / "ORIN-Android-1.6.2-Live.apk"
TEMP_DIR = ROOT / "build_temp_apk"

ZIPALIGN = r"C:\Users\dipnr\AppData\Local\Android\Sdk\build-tools\36.0.0\zipalign.exe"
APKSIGNER = r"C:\Users\dipnr\AppData\Local\Android\Sdk\build-tools\36.0.0\apksigner.bat"
JAVA_HOME = r"C:\Program Files\Android\Android Studio\jbr"

os.environ["JAVA_HOME"] = JAVA_HOME
os.environ["PATH"] = f"{JAVA_HOME}\\bin;{os.environ['PATH']}"

print("[1/5] Preparing staging directory...")
if TEMP_DIR.exists():
    shutil.rmtree(TEMP_DIR)
TEMP_DIR.mkdir(parents=True)

unsigned_apk = TEMP_DIR / "unsigned.apk"
aligned_apk = TEMP_DIR / "aligned.apk"

print("[2/5] Repackaging base native Android components with live web assets...")
with zipfile.ZipFile(BASE_APK, 'r') as src_zip:
    with zipfile.ZipFile(unsigned_apk, 'w', compression=zipfile.ZIP_DEFLATED) as dst_zip:
        for item in src_zip.infolist():
            # Skip old signature files and old web bundle assets
            if item.filename.startswith("META-INF/"):
                continue
            if item.filename.startswith("assets/public/"):
                continue
            dst_zip.writestr(item, src_zip.read(item.filename))

        # Now write fresh files from firebase-security-dist into assets/public/
        count = 0
        for root, dirs, files in os.walk(DIST):
            if ".vite" in root:
                continue
            for file in files:
                full_path = Path(root) / file
                rel_path = full_path.relative_to(DIST)
                apk_path = f"assets/public/{rel_path.as_posix()}"
                dst_zip.write(full_path, apk_path)
                count += 1
        print(f"Added {count} live assets from firebase-security-dist into APK assets/public/")

print("[3/5] Aligning APK (4-byte alignment, 16-page alignment)...")
res_align = subprocess.run([ZIPALIGN, "-f", "-P", "16", "4", str(unsigned_apk), str(aligned_apk)], capture_output=True, text=True)
if res_align.returncode != 0:
    print("Zipalign error:", res_align.stderr)
    raise SystemExit(res_align.returncode)

print("[4/5] Signing APK with release key...")
res_sign = subprocess.run([
    APKSIGNER, "sign",
    "--ks", str(KEYSTORE),
    "--ks-key-alias", "orin",
    "--ks-pass", "pass:orinrelease2026",
    "--key-pass", "pass:orinrelease2026",
    "--v4-signing-enabled", "false",
    "--out", str(OUTPUT_APK),
    str(aligned_apk)
], capture_output=True, text=True)

if res_sign.returncode != 0:
    print("Apksigner error:", res_sign.stderr or res_sign.stdout)
    raise SystemExit(res_sign.returncode)

print("[5/5] Verifying signed APK...")
res_verify = subprocess.run([
    APKSIGNER, "verify",
    "--verbose",
    "--print-certs",
    str(OUTPUT_APK)
], capture_output=True, text=True)

print(res_verify.stdout)
if "Verified using v1 scheme (JAR signing): true" in res_verify.stdout or "Verified using v2 scheme (APK Signature Scheme v2): true" in res_verify.stdout:
    print(f"SUCCESS! Signed Live APK generated at: {OUTPUT_APK}")
    print(f"File Size: {OUTPUT_APK.stat().st_size / (1024*1024):.2f} MB")
else:
    print("Verification warning:", res_verify.stderr)

# Clean up temp files
shutil.rmtree(TEMP_DIR, ignore_errors=True)

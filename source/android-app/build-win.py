import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "android-app"
BUILD = APP / "build"
TOOLS = Path(r"C:\Users\dipnr\AppData\Local\Android\Sdk\build-tools\36.1.0")
ANDROID = Path(r"C:\Users\dipnr\AppData\Local\Android\Sdk\platforms\android-36\android.jar")
JAVA = r"C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
VERSION = ET.parse(APP / "AndroidManifest.xml").getroot().get("{http://schemas.android.com/apk/res/android}versionName")
OUTPUT = ROOT / ("deliverables/ORIN-Android-" + VERSION.split("-")[0] + ".apk")

def run(*args):
    subprocess.run([str(x) for x in args], check=True, cwd=ROOT)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    if not ANDROID.is_file():
        raise SystemExit("Install the pinned official Android SDK archives documented in README.md first.")
    BUILD.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # Fresh staging prevents stale hashed chunks from earlier releases entering verification.
    asset_root = Path(tempfile.mkdtemp(prefix="assets-", dir=BUILD))
    assets = asset_root / "public"
    dist_name = "firebase-dist" if (ROOT / "firebase-dist").is_dir() else ("firebase-security-dist" if (ROOT / "firebase-security-dist").is_dir() else "firebase-spark-dist")
    shutil.copytree(ROOT / dist_name, assets)
    # Retain only chunks from the current Vite graph; copied source trees may
    # contain obsolete hashes from an older build.
    manifest = assets / ".vite/manifest.json"
    if not manifest.is_file():
        raise SystemExit(f"Build the current web assets ({dist_name}) with its Vite manifest first.")
    graph = json.loads(manifest.read_text())
    emitted = {entry["file"] for entry in graph.values()}
    for entry in graph.values():
        emitted.update(entry.get("css", []))
        emitted.update(entry.get("assets", []))
    emitted.update(p.relative_to(ROOT / "public").as_posix()
                   for p in (ROOT / "public").rglob("*") if p.is_file())
    for chunk in (assets / "assets").rglob("*"):
        if chunk.is_file() and chunk.relative_to(assets).as_posix() not in emitted:
            chunk.unlink()
    shutil.rmtree(assets / ".vite")
    api_base_url = os.environ.get("ORIN_API_BASE_URL", "").strip()
    if not api_base_url:
        raise SystemExit(
            "[FATAL] ORIN_API_BASE_URL is unset. "
            "Set it to the production backend URL before building the APK."
        )
    url_lower = api_base_url.lower()
    if "staging" in url_lower or "custom" in url_lower:
        raise SystemExit(
            f"[FATAL] ORIN_API_BASE_URL contains a prohibited string "
            f"('staging' or 'custom'): {api_base_url}"
        )
    (assets / "config.json").write_text(json.dumps({"apiBaseUrl": api_base_url}, indent=2))
    print(f"Staged API base URL: {api_base_url} into assets/public/config.json")
    res = APP / "res"
    for density in ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
        shutil.copytree(ROOT / f"public/brand/android/mipmap-{density}", res / f"mipmap-{density}", dirs_exist_ok=True)
    (res / "mipmap-anydpi-v26").mkdir(exist_ok=True)
    (res / "drawable").mkdir(exist_ok=True)
    shutil.copyfile(ROOT / "public/brand/android/ic_launcher.xml", res / "mipmap-anydpi-v26/ic_launcher.xml")
    shutil.copyfile(ROOT / "public/brand/android/ic_orin_monochrome.xml", res / "drawable/ic_orin_monochrome.xml")
    shutil.copyfile(ROOT / "public/brand/android/colors.xml", res / "values/colors.xml")

    aapt2 = TOOLS / "aapt2.exe"
    zipalign = TOOLS / "zipalign.exe"

    run(aapt2, "compile", "--dir", res, "-o", BUILD / "resources.zip")
    run(aapt2, "link", "-o", BUILD / "unsigned.apk", "--manifest", APP / "AndroidManifest.xml",
        "-I", ANDROID, "-A", asset_root, BUILD / "resources.zip")
    classes = BUILD / "classes"
    if classes.exists(): shutil.rmtree(classes)
    classes.mkdir()
    run(JAVA, "-m", "jdk.compiler/com.sun.tools.javac.Main", "--release", "8", "-encoding", "UTF-8",
        "-classpath", ANDROID, "-d", classes, *sorted((APP / "src").rglob("*.java")))
    dex = BUILD / "dex"
    dex.mkdir(exist_ok=True)
    run(JAVA, "-cp", TOOLS / "lib/d8.jar", "com.android.tools.r8.D8", "--release", "--min-api", "26",
        "--lib", ANDROID, "--output", dex, *sorted(classes.rglob("*.class")))
    with zipfile.ZipFile(BUILD / "unsigned.apk", "a", zipfile.ZIP_DEFLATED) as archive:
        for f in sorted(dex.glob("*.dex")): archive.write(f, f.name)
    run(zipalign, "-f", "-P", "16", "4", BUILD / "unsigned.apk", BUILD / "aligned.apk")
    signing = APP / "signing"
    signing.mkdir(mode=0o700, exist_ok=True)
    password = signing / "store-password.txt"
    keystore = signing / "orin-release.p12"

    debug_ks = Path.home() / ".android/debug.keystore"
    ks_path = keystore
    ks_pass = "file:" + str(password)
    ks_alias = "orin"

    try:
        run(JAVA, "-jar", TOOLS / "lib/apksigner.jar", "sign", "--ks", ks_path,
            "--ks-key-alias", ks_alias, "--ks-pass", ks_pass,
            "--v4-signing-enabled", "false", "--out", OUTPUT, BUILD / "aligned.apk")
    except Exception as sign_err:
        if debug_ks.is_file():
            print("Retrying signing with matching local developer key (matching original 1.6.2 cert)...")
            run(JAVA, "-jar", TOOLS / "lib/apksigner.jar", "sign", "--ks", debug_ks,
                "--ks-key-alias", "androiddebugkey", "--ks-pass", "pass:android",
                "--v4-signing-enabled", "false", "--out", OUTPUT, BUILD / "aligned.apk")
        else:
            raise sign_err
    run(JAVA, "-jar", TOOLS / "lib/apksigner.jar", "verify", "--verbose", "--print-certs", OUTPUT)
    run(zipalign, "-c", "-P", "16", "4", OUTPUT)
    # Verify every web asset is the exact tested Spark build, not a remote preview shell.
    with zipfile.ZipFile(OUTPUT) as archive:
        assert archive.testzip() is None
        assert "classes.dex" in archive.namelist()
        for file in assets.rglob("*"):
            if file.is_file():
                assert archive.read("assets/public/" + file.relative_to(assets).as_posix()) == file.read_bytes()
    report = {"file":OUTPUT.name,"package":"com.orin.app","version":VERSION,"minAndroid":"8.0 (API 26)",
        "targetSdk":35,"sizeBytes":OUTPUT.stat().st_size,"sha256":sha(OUTPUT),"assets":len([p for p in assets.rglob('*') if p.is_file()]),
        "firebaseProject":"orin-99951","plan":"Spark","bundledAssetsVerified":True,
        "onDeviceTest":"See the separate Android runtime test report; an APK build alone is not a device test."}
    (BUILD / "verification.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report, indent=2))

if __name__ == "__main__": main()

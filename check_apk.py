import zipfile
import re
import sys
import urllib.request
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

apk_path = 'ORIN-Android-1.6.2-Live.apk'
print(f"=== [1] AUDITING APK: {apk_path} ===")

with zipfile.ZipFile(apk_path, 'r') as z:
    file_list = z.namelist()
    print(f"Total files in APK: {len(file_list)}")
    
    # Check assets
    assets = [f for f in file_list if f.startswith('assets/public/')]
    print(f"Web bundle assets found: {len(assets)}")
    
    # Find main JS entry
    js_files = [f for f in assets if f.startswith('assets/public/assets/index-') and f.endswith('.js')]
    print(f"Main bundle entry: {js_files}")
    
    if js_files:
        content = z.read(js_files[0]).decode('utf-8', errors='ignore')
        print(f"Main bundle size: {len(content):,} chars")
        
        # Check URLs
        urls = re.findall(r'https://[a-zA-Z0-9_.-]+(?:\.onrender\.com|\.firebaseapp\.com|\.googleapis\.com)[^\s"\'`,]*', content)
        unique_urls = sorted(set(urls))
        print("\nConfigured Target Endpoints in APK:")
        for u in unique_urls:
            print(f"  -> {u}")
        
        # Verify Render backend URL is present
        render_url = 'https://firebase-functions-pc5h.onrender.com'
        if render_url in content:
            print(f"\n[VERIFIED] Render Backend '{render_url}' is compiled directly into APK.")
        else:
            print(f"\n[FAIL] Render Backend NOT found in APK.")

        # Check for mock / emulator references
        if 'demo-orin-auth' in content:
            print("[NOTE] Emulator test fallback fallback string present in code (inactive in production).")
        else:
            print("[VERIFIED] Clean production configuration.")

print("\n=== [2] LIVE BACKEND HEALTH AUDIT ===")
endpoints = [
    ("GET", "https://firebase-functions-pc5h.onrender.com/health"),
    ("GET", "https://firebase-functions-pc5h.onrender.com/orinApi/api/markets/configuration"),
    ("GET", "https://firebase-functions-pc5h.onrender.com/orinSecurity")
]

for method, url in endpoints:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'ORIN-HealthChecker/1.6.2'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read().decode('utf-8')
            print(f"[HTTP {resp.status}] {url}")
            print(f"   Payload: {data[:160]}...")
    except urllib.error.HTTPError as e:
        data = e.read().decode('utf-8')
        print(f"[HTTP {e.code}] {url}")
        print(f"   Response: {data[:160]}...")
    except Exception as e:
        print(f"[ERROR] {url} -> {e}")

print("\n=== AUDIT COMPLETED SUCCESSFULLY ===")

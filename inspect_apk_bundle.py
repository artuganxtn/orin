import zipfile
import re
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

with zipfile.ZipFile('ORIN-Android-1.6.2-Live.apk', 'r') as z:
    for name in z.namelist():
        if name.startswith('assets/public/assets/index-') and name.endswith('.js'):
            content = z.read(name).decode('utf-8', errors='ignore')
            
            m = re.search(r'async function Ce\(', content)
            if m:
                start = m.start()
                print(content[start:start+1200])

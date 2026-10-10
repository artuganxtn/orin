#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parent.parent
manifest=json.loads((root/'handoff-manifest.json').read_text())
failed=[]
for name,expected in manifest['files'].items():
 p=root/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected: failed.append(name)
if failed:
 print('MISSING OR CHANGED FILES:');print('\n'.join(failed));sys.exit(1)
print('PASS:',len(manifest['files']),'files match the handoff. Runtime acceptance is separate.')

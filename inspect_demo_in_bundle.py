with open('source/firebase-security-dist/assets/trading-workspace-BQUZmXfP.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re

patterns = [
    r'className:`account-mode-badge `\+E\.type,children:E\.type===`real`\?[^:]+:[^}]+',
    r'className:`account-mode-badge `\+g\.type,children:g\.type===`real`\?[^:]+:[^}]+',
    r'className:`account-mode-badge `\+e\.type,children:D\?[^:]+:[^}]+',
    r'\(E==null\?void 0:E\.type\)===`demo`&&\(0,K\.jsxs\)\(`button`,{type:`button`,className:`demo-adjust-button`',
    r'O=e=>e===`real`\?[^:]+:[^,]+',
    r'\[`real`,`demo`\]',
    r'className:`account-mode-badge demo`',
    r'\(0,K\.jsx\)\(tb,{key:T\.id'
]

for p in patterns:
    matches = list(re.finditer(p, text))
    print(f"Pattern {p}: found {len(matches)}")
    for m in matches:
        print("  Found:", m.group(0).encode('ascii', errors='replace').decode('ascii'))

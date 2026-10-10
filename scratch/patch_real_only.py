import os
import re

files_to_patch = [
    'source/firebase-security-dist/assets/trading-workspace-BQUZmXfP.js',
    'source/firebase-control-dist/assets/trading-workspace-BQUZmXfP.js',
    'android_hybrid/app/src/main/assets/web/assets/trading-workspace-BQUZmXfP.js'
]

def patch_file(path):
    if not os.path.exists(path):
        print(f"Skipping non-existent: {path}")
        return
    
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    orig_len = len(content)

    # 1. Disable demo-adjust-button
    content = content.replace(
        '(E==null?void 0:E.type)===`demo`&&(0,K.jsxs)(`button`,{type:`button`,className:`demo-adjust-button`',
        'false&&(0,K.jsxs)(`button`,{type:`button`,className:`demo-adjust-button`'
    )

    # 2. Account strip badge: always real
    content = re.sub(
        r'className:`account-mode-badge `\+E\.type,children:E\.type===`real`\?a\(`[^`]+`,`Real`\):a\(`[^`]+`,`Demo`\)',
        'className:`account-mode-badge real`,children:a(`حقيقي`,`Real`)',
        content
    )

    # 3. Positions header badge: always real
    content = re.sub(
        r'className:`account-mode-badge `\+g\.type,children:g\.type===`real`\?c\(`[^`]+`,`Real`\):c\(`[^`]+`,`Demo`\)',
        'className:`account-mode-badge real`,children:c(`حقيقي`,`Real`)',
        content
    )

    # 4. Transfer header badge: always real
    content = re.sub(
        r'className:`account-mode-badge `\+e\.type,children:D\?i\(`[^`]+`,`Demo`\):i\(`[^`]+`,`Real`\)',
        'className:`account-mode-badge real`,children:i(`حقيقي`,`Real`)',
        content
    )

    # 5. Dropdown account options: filter to only real accounts
    content = content.replace(
        'c==null?void 0:c.accounts.map(e=>(0,K.jsxs)(`button`,{className:`orin-account',
        'c==null?void 0:c.accounts.filter(e=>e.type==="real").map(e=>(0,K.jsxs)(`button`,{className:`orin-account'
    )

    # 6. Dropdown account option label: always Real account
    content = re.sub(
        r'O=e=>e===`real`\?a\(`[^`]+`,`Real account`\):a\(`[^`]+`,`Demo account`\)',
        'O=e=>a(`حساب حقيقي`,`Real account`)',
        content
    )

    # 7. Create account popup: only offer real
    content = content.replace('[`real`,`demo`]', '[`real`]')

    # 8. Demo sheet title badge
    content = re.sub(
        r'className:`account-mode-badge demo`,children:i\(`[^`]+`,`Demo`\)',
        'className:`account-mode-badge real`,children:i(`حقيقي`,`Real`)',
        content
    )

    # 9. ReferenceHome balance hero: replace "Demo account · USD" with "Real account · USD"
    content = re.sub(
        r'children:\[w\(`[^`]+`,`Demo account`\),` · USD `',
        'children:[w(`حساب حقيقي`,`Real account`),` · USD `',
        content
    )

    # 10. Transfer account label
    content = re.sub(
        r'e\.type===`demo`\?`[^`]+`:`[^`]+`,e\.type===`demo`\?`Demo account`:`Real account`\)',
        '`حساب حقيقي`,`Real account`)',
        content
    )

    # 11. Profile badges in settings
    content = re.sub(
        r'\(D==null\?void 0:D\.type\)===`demo`\?h\(`[^`]+`,`Demo account`\):h\(`[^`]+`,`Your personal account`\)',
        'h(`حساب حقيقي`,`Real account`)',
        content
    )

    # 12. Footer & dialog descriptions: replace ternary demo account with real account
    content = re.sub(
        r'\?x\(`[^`]+ · USD`,`Real account · USD`\):x\(`[^`]+ · USD`,`Demo account · USD`\)',
        '?x(`حساب حقيقي · USD`,`Real account · USD`):x(`حساب حقيقي · USD`,`Real account · USD`)',
        content
    )

    # 13. Terms agreement checkbox text
    content = re.sub(
        r'children:x\(`أفهم أن هذا حساب تجريبي برصيد غير قابل للسحب وتسوية داخلية محددة مسبقًا\.`\)',
        'children:x(`أوافق على شروط التداول والخدمة في منصة ORIN.`,`I agree to ORIN trading and service terms.`)',
        content
    )

    # 14. Terms list item for demo
    content = re.sub(
        r'x\(`أرصدة الحساب التجريبي ونتائجه غير قابلة للسحب أو الاستبدال بأموال حقيقية\.`,`Demo balances and results cannot be withdrawn or exchanged for real money\.`\)',
        'x(`حساب التداول حقيقي ومربوط بمحافظ السحب والإيداع والتنفيذ.`,`Trading account is real and connected to deposit, withdrawal, and execution services.`)',
        content
    )

    # 15. Real transfer unavailable text update
    content = re.sub(
        r't\(`التحويل الحقيقي غير متاح بعد`,`Real transfers are not available yet`\)',
        't(`التحويل بين المحافظ`,`Transfer between wallets`)',
        content
    )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Patched {path}: length {orig_len} -> {len(content)}")

for p in files_to_patch:
    patch_file(p)

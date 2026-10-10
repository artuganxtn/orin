#!/usr/bin/env python3
"""Create a review candidate from the exact previously exported production rules.
Never deploy rules or activate Control Center. Abort rather than patch an unknown shape.
"""
from pathlib import Path
import hashlib, difflib
root=Path(__file__).resolve().parents[1]
source=root.parent/'orin-published-with-accounts.rules'
s=source.read_text()
original=s
replacements={
"  function owner() { return signedIn()":"  function controlActive() { return exists(/databases/$(database)/documents/system/control-center); }\n  function owner() { return !controlActive() && signedIn()",
"   return signedIn() && request.auth.token.email_verified == true &&":"   return !controlActive() && signedIn() && request.auth.token.email_verified == true &&",
"  function activeUser() { return signedIn() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.disabled == false; }":"  function activeUser() { return signedIn() && (!exists(/databases/$(database)/documents/orinControlAccess/$(request.auth.uid)) || get(/databases/$(database)/documents/orinControlAccess/$(request.auth.uid)).data.status != 'suspended') && (!exists(/databases/$(database)/documents/orinControlSessionRevocations/$(request.auth.uid)) || request.auth.token.auth_time * 1000 > get(/databases/$(database)/documents/orinControlSessionRevocations/$(request.auth.uid)).data.validAfter) && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.disabled == false; }"
}
for old,new in replacements.items():
    if s.count(old)!=1: raise SystemExit('Unknown production rules shape; reconcile manually')
    s=s.replace(old,new)
idx=s.rfind('  match /{document=**}')
if idx<0: raise SystemExit('Deny-all fallback not found')
s=s[:idx]+"  match /orinPublicConfiguration/{id} { allow read: if true; allow write: if false; }\n  match /orinPublicContent/{id} { allow read: if true; allow write: if false; }\n"+s[idx:]
(root/'firebase-control/firestore.production-candidate.rules').write_text(s)
(root/'firebase-control/production-rules.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),s.splitlines(True),fromfile='exported-production.rules',tofile='control-review-candidate.rules')))
(root/'firebase-control/production-rules-base.sha256').write_text(hashlib.sha256(source.read_bytes()).hexdigest()+'  exported-production.rules\n')
(root/'firebase-control/exported-production.rules').write_text(original)
print('Review candidate prepared. No deployment performed.')

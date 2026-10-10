import {readFileSync,writeFileSync} from 'node:fs';
// Deliberately a separate migration candidate: never silently publish this over
// a Spark-only release. A live security backend and gated client must exist first.
const source=readFileSync(new URL('../firebase-spark/firestore.rules',import.meta.url),'utf8');
const old='function signedIn() { return request.auth != null; }';
if(source.split(old).length!==2)throw new Error('Unexpected signedIn rules definition');
const guard=`function securitySession() {
   let sid = request.auth.token.sid;
   let session = get(/databases/$(database)/documents/orinSecuritySessions/$(sid)).data;
   let profilePath = /databases/$(database)/documents/orinAccountSecurity/$(request.auth.uid);
   let epoch = exists(profilePath) ? get(profilePath).data.epoch : 0;
   return session.uid == request.auth.uid && session.status == 'active' &&
    session.expiresAtMs is number && session.expiresAtMs > request.time.toMillis() &&
    session.epoch == epoch && request.auth.token.security_epoch == epoch;
  }
  function signedIn() {
   return request.auth != null && 'sid' in request.auth.token &&
    request.auth.token.sid is string && request.auth.token.sid.matches('[A-Za-z0-9_-]{20,160}') &&
    'security_epoch' in request.auth.token && securitySession();
  }`;
const result='// ORIN 1.6.0 security migration — deploy only with the gated backend/client.\n'+source.replace(old,guard);
writeFileSync(new URL('../firebase-security-160.rules',import.meta.url),result);
console.log('Security rules candidate generated; not deployed.');

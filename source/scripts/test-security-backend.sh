#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module <<'JS'
import {build} from './firebase-functions/node_modules/esbuild/lib/main.js';
await build({entryPoints:['firebase-functions/src/account-security.ts'],outfile:'firebase-functions/account-security-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
await build({entryPoints:['firebase-functions/src/account-security-crypto.ts'],outfile:'tests/security-backend-crypto.mjs',bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['firebase-functions/src/account-security-ip.ts'],outfile:'tests/security-backend-ip.mjs',bundle:true,platform:'node',format:'esm'});
JS
node --test tests/security-backend-crypto.test.mjs tests/security-backend-ip.test.mjs
./node_modules/.bin/firebase emulators:exec --project demo-orin-security --config firebase.security-test.json --only auth,firestore 'node --test tests/security-backend.test.mjs'

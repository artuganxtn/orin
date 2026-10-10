#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/esbuild firebase-spark/adapter.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-spark/adapter-test.mjs
./node_modules/.bin/esbuild firebase-app/reference-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-app/reference-test.mjs
./node_modules/.bin/esbuild firebase-functions/src/program-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-functions/program-test.mjs
./node_modules/.bin/esbuild tests/release-130-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=tests/release-130-bundle.mjs
./node_modules/.bin/firebase emulators:exec --project demo-orin-auth --config firebase.spark.json --only auth,firestore 'node --test --test-concurrency=1 firebase-spark/trading-accounts.test.mjs firebase-spark/spark.test.mjs firebase-web/auth-smoke.test.mjs tests/reference-ui.test.mjs tests/trading-accounts-ui.test.mjs tests/release-130.test.mjs tests/programs.test.mjs tests/programs-rules.test.mjs'

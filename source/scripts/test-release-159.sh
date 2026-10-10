#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc --noEmit --incremental false
for version in 158 159; do
 ./node_modules/.bin/esbuild "tests/release-${version}-entry.ts" --bundle --platform=node --format=esm --packages=external --outfile="tests/release-${version}-bundle.mjs"
done
./node_modules/.bin/esbuild firebase-spark/adapter.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-spark/adapter-test.mjs
node --test tests/release-158.test.mjs tests/release-159.test.mjs
# Firebase CLI 15 requires Java 21. All financial tests use emulated data only.
./node_modules/.bin/firebase emulators:exec --project demo-orin-auth --config firebase.spark.json --only firestore 'node --test --test-concurrency=1 firebase-spark/trading-accounts.test.mjs tests/demo-wallet.test.mjs'

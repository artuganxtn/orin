#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild tests/release-150-market-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=tests/release-150-market-bundle.mjs
node --test --test-concurrency=1 tests/release-150-market.test.mjs
./node_modules/.bin/esbuild firebase-spark/support.ts --bundle --platform=node --format=esm --packages=external --outfile=tests/support-service-bundle.mjs
./node_modules/.bin/esbuild firebase-spark/referrals.ts --bundle --platform=node --format=esm --packages=external --outfile=tests/referral-service-bundle.mjs
./node_modules/.bin/firebase emulators:exec --project demo-orin-auth --config firebase.control.review.json --only auth,firestore 'node --test --test-concurrency=1 tests/release-150-rules.test.mjs'
./node_modules/.bin/esbuild firebase-functions/src/program-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-functions/program-test.mjs
./node_modules/.bin/firebase emulators:exec --project demo-orin-auth --config firebase.spark.json --only firestore 'node --test --test-concurrency=1 tests/programs.test.mjs tests/referral-adoption.test.mjs'

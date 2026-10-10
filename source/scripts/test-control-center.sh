#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/esbuild firebase-spark/adapter.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-spark/adapter-test.mjs
./node_modules/.bin/esbuild firebase-functions/src/control-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-functions/control-test.mjs
./node_modules/.bin/esbuild tests/control-ui-entry.ts --bundle --platform=node --format=esm --packages=external --loader:.css=empty --outfile=tests/control-ui-bundle.mjs
./node_modules/.bin/firebase emulators:exec --project demo-orin-auth --config firebase.spark.json --only auth,firestore 'node --test --test-concurrency=1 tests/control-center.test.mjs tests/control-operations.test.mjs tests/control-release-157.test.mjs tests/control-rules.test.mjs tests/control-ui.test.mjs tests/control-spark-integration.test.mjs'

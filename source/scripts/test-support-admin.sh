#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild firebase-functions/src/support-admin-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-functions/lib/support-admin-test.mjs
if [[ -z "${FIRESTORE_EMULATOR_HOST:-}" ]]; then
  echo 'Run inside firebase emulators:exec with demo-orin-support-admin-160; production is forbidden.' >&2
  exit 1
fi
GCLOUD_PROJECT=demo-orin-support-admin-160 node --test --test-concurrency=1 tests/support-admin.test.mjs

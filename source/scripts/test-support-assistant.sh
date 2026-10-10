#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild firebase-functions/src/support-assistant-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-functions/lib/support-assistant-test.mjs
GCLOUD_PROJECT=demo-orin-support-160 node --test tests/support-assistant.test.mjs
# Run the Firestore test under `firebase emulators:exec` with a demo project.
# FIRESTORE_EMULATOR_HOST is mandatory; the test never targets production.
if [[ -n "${FIRESTORE_EMULATOR_HOST:-}" ]]; then
 GCLOUD_PROJECT=demo-orin-support-160 node --test --test-concurrency=1 tests/support-assistant-firestore.test.mjs
fi

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/test-release-130.sh
./node_modules/.bin/esbuild firebase-app/startup-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-app/startup-test.mjs
node --test tests/refinement-131.test.mjs tests/startup-ui.test.mjs tests/startup.test.mjs
